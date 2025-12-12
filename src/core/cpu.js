import { toHex32, signExtend } from './utils.js';
import { alu } from './alu.js';
import { controlUnit } from './control.js';

export const Stage = {
    FETCH: "FETCH",
    DECODE: "DECODE",
    EXEC: "EXEC",
    MEM: "MEM",
    WB: "WB",
};

export class RISCVProcessor {
    constructor() {
        this.state = {
            pc: 0 >>> 0,
            cycle: 0,
            regs: new Uint32Array(32),
            dataMem: new Uint32Array(32),
            instrMem: new Uint32Array(256),
            halted: false,
        };
        this.reset();
    }

    reset() {
        this.state.pc = 0 >>> 0;
        this.state.cycle = 0;
        this.state.halted = false;

        // Banco de registros
        this.state.regs = new Uint32Array(32);
        this.state.regs[0] = 0x00000000 >>> 0;
        this.state.regs[1] = 0x00000001 >>> 0;
        this.state.regs[2] = 0x00000002 >>> 0;
        this.state.regs[3] = 0xfffffffd >>> 0;
        this.state.regs[4] = 0x00000000 >>> 0;
        this.state.regs[5] = 0x00000005 >>> 0;
        this.state.regs[7] = 0x00000007 >>> 0;

        // Memoria de datos
        this.state.dataMem = new Uint32Array(32);
        this.state.dataMem.set([
            0x00000005,
            0x000000af,
            0x000000d2,
            0x00000003
        ]);

        // No borramos instrMem aquí para persistir el programa cargado
    }


    loadProgram(sourceCode) {
        this.state.instrMem.fill(0);
        const lines = sourceCode
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));

        let addr = 0;
        for (const line of lines) {
            let value = NaN;

            // Si es sólo hexadecimal (p.ej. 00400093)
            if (/^[0-9a-fA-F]+$/.test(line)) {
                value = parseInt(line, 16);
            } else {
                // Interpretar como instrucción en ensamblador RISC-V
                value = this.assembleLine(line, addr * 4);
            }

            if (value != null && !Number.isNaN(value)) {
                this.state.instrMem[addr++] = value >>> 0;
            }
        }
        this.reset();
        return addr; // Retorna número de instrucciones cargadas
    }

    assembleLine(line, pc = 0) {
        // Quitar comentarios
        const clean = line.split(/[#;]/)[0].trim();
        if (!clean) return null;

        // Separar por comas y espacios
        const parts = clean.replace(/,/g, " ").split(/\s+/).filter(Boolean);
        const mn = parts[0].toLowerCase();

        const reg = (token) => {
            // Aceptar formato x0-x31
            const m = token.match(/^x(\d{1,2})$/i);
            if (!m) throw new Error(`Registro inválido: ${token}`);
            const n = parseInt(m[1], 10);
            if (n < 0 || n > 31) throw new Error(`Registro fuera de rango: ${token}`);
            return n;
        };

        const immVal = (token) => {
            if (/^0x[0-9a-fA-F]+$/.test(token)) {
                return parseInt(token, 16) | 0;
            }
            return parseInt(token, 10) | 0;
        };

        const encodeR = (funct7, rs2, rs1, funct3, rd, opcode) => {
            return (
                ((funct7 & 0x7f) << 25) |
                ((rs2 & 0x1f) << 20) |
                ((rs1 & 0x1f) << 15) |
                ((funct3 & 0x7) << 12) |
                ((rd & 0x1f) << 7) |
                (opcode & 0x7f)
            ) >>> 0;
        };

        const encodeI = (imm, rs1, funct3, rd, opcode) => {
            const imm12 = imm & 0xfff;
            return (
                ((imm12 & 0xfff) << 20) |
                ((rs1 & 0x1f) << 15) |
                ((funct3 & 0x7) << 12) |
                ((rd & 0x1f) << 7) |
                (opcode & 0x7f)
            ) >>> 0;
        };

        const encodeS = (imm, rs2, rs1, funct3, opcode) => {
            const imm12 = imm & 0xfff;
            const imm4_0 = imm12 & 0x1f;
            const imm11_5 = (imm12 >> 5) & 0x7f;
            return (
                ((imm11_5 & 0x7f) << 25) |
                ((rs2 & 0x1f) << 20) |
                ((rs1 & 0x1f) << 15) |
                ((funct3 & 0x7) << 12) |
                ((imm4_0 & 0x1f) << 7) |
                (opcode & 0x7f)
            ) >>> 0;
        };

        const encodeB = (imm, rs2, rs1, funct3, opcode) => {
            // imm es desplazamiento en bytes (múltiplo de 2)
            const imm13 = imm & 0x1fff;
            const imm12 = (imm13 >> 12) & 0x1;
            const imm10_5 = (imm13 >> 5) & 0x3f;
            const imm4_1 = (imm13 >> 1) & 0x0f;
            const imm11 = (imm13 >> 11) & 0x1;

            return (
                ((imm12 & 0x1) << 31) |
                ((imm10_5 & 0x3f) << 25) |
                ((rs2 & 0x1f) << 20) |
                ((rs1 & 0x1f) << 15) |
                ((funct3 & 0x7) << 12) |
                ((imm4_1 & 0x0f) << 8) |
                ((imm11 & 0x1) << 7) |
                (opcode & 0x7f)
            ) >>> 0;
        };

        const encodeU = (imm, rd, opcode) => {
            const imm20 = imm & 0xfffff;
            return (
                ((imm20 & 0xfffff) << 12) |
                ((rd & 0x1f) << 7) |
                (opcode & 0x7f)
            ) >>> 0;
        };

        const encodeJ = (imm, rd, opcode) => {
            // imm es desplazamiento en bytes (múltiplo de 2)
            const imm21 = imm & 0x1fffff;
            const imm20 = (imm21 >> 20) & 0x1;
            const imm10_1 = (imm21 >> 1) & 0x3ff;
            const imm11 = (imm21 >> 11) & 0x1;
            const imm19_12 = (imm21 >> 12) & 0xff;

            return (
                ((imm20 & 0x1) << 31) |
                ((imm19_12 & 0xff) << 12) |
                ((imm11 & 0x1) << 20) |
                ((imm10_1 & 0x3ff) << 21) |
                ((rd & 0x1f) << 7) |
                (opcode & 0x7f)
            ) >>> 0;
        };

        // ------------ R-TYPE ------------
        if (mn === "add" || mn === "sub" || mn === "and" || mn === "or" || mn === "xor") {
            const rd = reg(parts[1]);
            const rs1 = reg(parts[2]);
            const rs2 = reg(parts[3]);
            let funct7 = 0x00;
            let funct3 = 0x0;

            if (mn === "add") { funct7 = 0x00; funct3 = 0x0; }
            if (mn === "sub") { funct7 = 0x20; funct3 = 0x0; }
            if (mn === "and") { funct7 = 0x00; funct3 = 0x7; }
            if (mn === "or")  { funct7 = 0x00; funct3 = 0x6; }
            if (mn === "xor") { funct7 = 0x00; funct3 = 0x4; }

            return encodeR(funct7, rs2, rs1, funct3, rd, 0x33);
        }

        // ------------ I-TYPE ARITH / LOAD ------------
        if (mn === "addi" || mn === "andi" || mn === "ori" || mn === "xori") {
            const rd = reg(parts[1]);
            const rs1 = reg(parts[2]);
            const imm = immVal(parts[3]);
            let funct3 = 0x0;
            if (mn === "andi") funct3 = 0x7;
            if (mn === "ori") funct3 = 0x6;
            if (mn === "xori") funct3 = 0x4;

            return encodeI(imm, rs1, funct3, rd, 0x13);
        }

        if (mn === "lw") {
            const rd = reg(parts[1]);
            // Sintaxis: lw rd, imm(rs1)
            const offsetBase = parts[2];
            const m = offsetBase.match(/^(-?\d+|0x[0-9a-fA-F]+)\((x\d{1,2})\)$/);
            if (!m) throw new Error(`Formato lw inválido: ${clean}`);
            const imm = immVal(m[1]);
            const rs1 = reg(m[2]);
            const funct3 = 0x2; // LW
            return encodeI(imm, rs1, funct3, rd, 0x03);
        }

        // ------------ S-TYPE (STORE) ------------
        if (mn === "sw") {
            // Sintaxis: sw rs2, imm(rs1)
            const rs2 = reg(parts[1]);
            const offsetBase = parts[2];
            const m = offsetBase.match(/^(-?\d+|0x[0-9a-fA-F]+)\((x\d{1,2})\)$/);
            if (!m) throw new Error(`Formato sw inválido: ${clean}`);
            const imm = immVal(m[1]);
            const rs1 = reg(m[2]);
            const funct3 = 0x2; // SW
            return encodeS(imm, rs2, rs1, funct3, 0x23);
        }

        // ------------ BRANCHES ------------
        if (mn === "beq" || mn === "bne") {
            const rs1 = reg(parts[1]);
            const rs2 = reg(parts[2]);
            const imm = immVal(parts[3]);
            let funct3 = 0x0;
            if (mn === "bne") funct3 = 0x1;
            return encodeB(imm, rs2, rs1, funct3, 0x63);
        }

        // ------------ U-TYPE ------------
        if (mn === "lui") {
            const rd = reg(parts[1]);
            const imm = immVal(parts[2]);
            return encodeU(imm, rd, 0x37);
        }

        // ------------ J-TYPE ------------
        if (mn === "jal") {
            const rd = reg(parts[1]);
            const imm = immVal(parts[2]);
            return encodeJ(imm, rd, 0x6f);
        }

        throw new Error(`Instrucción ensamblador no soportada: ${line}`);
    }

    decode(instr) {
        const opcode = instr & 0x7f;
        const rd = (instr >>> 7) & 0x1f;
        const funct3 = (instr >>> 12) & 0x7;
        const rs1 = (instr >>> 15) & 0x1f;
        const rs2 = (instr >>> 20) & 0x1f;
        const funct7 = (instr >>> 25) & 0x7f;

        let imm = 0;
        let immType = "";

        if (opcode === 0x13 || opcode === 0x03) {
            imm = signExtend(instr >>> 20, 12);
            immType = "I";
        } else if (opcode === 0x23) {
            const imm4_0 = (instr >>> 7) & 0x1f;
            const imm11_5 = (instr >>> 25) & 0x7f;
            imm = signExtend((imm11_5 << 5) | imm4_0, 12);
            immType = "S";
        } else if (opcode === 0x63) {
            const imm12 = (instr >>> 31) & 0x1;
            const imm10_5 = (instr >>> 25) & 0x3f;
            const imm4_1 = (instr >>> 8) & 0x0f;
            const imm11 = (instr >>> 7) & 0x1;
            const raw = (imm12 << 12) | (imm11 << 11) | (imm10_5 << 5) | (imm4_1 << 1);
            imm = signExtend(raw, 13);
            immType = "B";
        }

        return { opcode, rd, funct3, rs1, rs2, funct7, imm, immType };
    }

    step(onStageUpdate) {
        if (this.state.halted) return null;

        this.state.cycle++;

        // FETCH
        if (onStageUpdate) onStageUpdate(Stage.FETCH);
        const index = (this.state.pc >>> 2) & 0xff;
        const instr = this.state.instrMem[index] >>> 0;

        // DECODE
        if (onStageUpdate) onStageUpdate(Stage.DECODE);
        const decoded = this.decode(instr);
        const ctrl = controlUnit(decoded);
        const { rs1, rs2, rd, imm } = decoded;

        // READ REGISTERS
        const a = this.state.regs[rs1] | 0;
        let breg = this.state.regs[rs2] | 0;

        // EXEC
        if (onStageUpdate) onStageUpdate(Stage.EXEC);
        const alu_b = ctrl.alu_src ? imm : breg;
        const alu_res = alu(a, alu_b, ctrl.alu_op);

        // MEM
        if (onStageUpdate) onStageUpdate(Stage.MEM);
        let memData = 0;
        if (ctrl.wem) {
            const addrIndex = (alu_res >>> 2) & 0x1f;
            this.state.dataMem[addrIndex] = breg >>> 0;
        } else if (decoded.opcode === 0x03) {
            const addrIndex = (alu_res >>> 2) & 0x1f;
            memData = this.state.dataMem[addrIndex] >>> 0;
        }

        // BRANCH
        let pc_next = (this.state.pc + 4) | 0;
        if (ctrl.branch) {
            let take = false;
            if (!ctrl.branch_ne && alu_res === 1) take = true; // BEQ
            if (ctrl.branch_ne && alu_res === 0) take = true; // BNE
            if (take) {
                pc_next = (this.state.pc + (decoded.imm | 0)) | 0;
            }
        }

        // WB
        if (onStageUpdate) onStageUpdate(Stage.WB);
        if (!ctrl.wem && decoded.opcode !== 0x63 && rd !== 0) {
            const value = decoded.opcode === 0x03 && ctrl.alu2reg ? memData : alu_res;
            this.state.regs[rd] = value >>> 0;
        }

        this.state.pc = pc_next >>> 0;

        return {
            instr,
            decoded,
            ctrl,
            alu_res,
            alu_b
        };
    }

    // Método asíncrono que ejecuta cada etapa con delays
    async stepWithStageDelay(onStageUpdate, stageDelay = 400) {
        if (this.state.halted) return null;

        this.state.cycle++;

        // FETCH
        if (onStageUpdate) onStageUpdate(Stage.FETCH);
        await this._delay(stageDelay);
        const index = (this.state.pc >>> 2) & 0xff;
        const instr = this.state.instrMem[index] >>> 0;

        // DECODE
        if (onStageUpdate) onStageUpdate(Stage.DECODE);
        await this._delay(stageDelay);
        const decoded = this.decode(instr);
        const ctrl = controlUnit(decoded);
        const { rs1, rs2, rd, imm } = decoded;

        // READ REGISTERS
        const a = this.state.regs[rs1] | 0;
        let breg = this.state.regs[rs2] | 0;

        // EXEC
        if (onStageUpdate) onStageUpdate(Stage.EXEC);
        await this._delay(stageDelay);
        const alu_b = ctrl.alu_src ? imm : breg;
        const alu_res = alu(a, alu_b, ctrl.alu_op);

        // MEM
        if (onStageUpdate) onStageUpdate(Stage.MEM);
        await this._delay(stageDelay);
        let memData = 0;
        if (ctrl.wem) {
            const addrIndex = (alu_res >>> 2) & 0x1f;
            this.state.dataMem[addrIndex] = breg >>> 0;
        } else if (decoded.opcode === 0x03) {
            const addrIndex = (alu_res >>> 2) & 0x1f;
            memData = this.state.dataMem[addrIndex] >>> 0;
        }

        // BRANCH
        let pc_next = (this.state.pc + 4) | 0;
        if (ctrl.branch) {
            let take = false;
            if (!ctrl.branch_ne && alu_res === 1) take = true; // BEQ
            if (ctrl.branch_ne && alu_res === 0) take = true; // BNE
            if (take) {
                pc_next = (this.state.pc + (decoded.imm | 0)) | 0;
            }
        }

        // WB
        if (onStageUpdate) onStageUpdate(Stage.WB);
        await this._delay(stageDelay);
        if (!ctrl.wem && decoded.opcode !== 0x63 && rd !== 0) {
            const value = decoded.opcode === 0x03 && ctrl.alu2reg ? memData : alu_res;
            this.state.regs[rd] = value >>> 0;
        }

        this.state.pc = pc_next >>> 0;

        return {
            instr,
            decoded,
            ctrl,
            alu_res,
            alu_b
        };
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}