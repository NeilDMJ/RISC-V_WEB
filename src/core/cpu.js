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

    loadProgram(hexString) {
        this.state.instrMem.fill(0);
        const lines = hexString
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));

        let addr = 0;
        for (const line of lines) {
            const value = parseInt(line, 16);
            if (!Number.isNaN(value)) {
                this.state.instrMem[addr++] = value >>> 0;
            }
        }
        this.reset();
        return addr; // Retorna número de instrucciones cargadas
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
}
