export function toHex32(v) {
    return "0x" + (v >>> 0).toString(16).padStart(8, "0");
}

export function toInt32(v) {
    return (v << 0);
}

export function signExtend(value, bits) {
    const shift = 32 - bits;
    return (value << shift) >> shift;
}



function reg(x) {
    return parseInt(x.replace("x", ""));
}

// Codificadores
function R(f7, f3, op, rd, rs1, rs2) {
    return (f7 << 25) | (rs2 << 20) | (rs1 << 15) |
        (f3 << 12) | (rd << 7) | op;
}

function I(f3, op, rd, rs1, imm) {
    imm &= 0xFFF;
    return (imm << 20) | (rs1 << 15) |
        (f3 << 12) | (rd << 7) | op;
}

function S(f3, op, rs1, rs2, imm) {
    const imm11_5 = (imm >> 5) & 0x7F;
    const imm4_0 = imm & 0x1F;
    return (imm11_5 << 25) | (rs2 << 20) | (rs1 << 15) |
        (f3 << 12) | (imm4_0 << 7) | op;
}

function B(f3, op, rs1, rs2, imm) {
    const imm12 = (imm >> 12) & 1;
    const imm10_5 = (imm >> 5) & 0x3F;
    const imm4_1 = (imm >> 1) & 0xF;
    const imm11 = (imm >> 11) & 1;

    return (imm12 << 31) | (imm10_5 << 25) | (rs2 << 20) |
        (rs1 << 15) | (f3 << 12) |
        (imm11 << 7) | (imm4_1 << 8) | op;
}

function isRegister(t) {
    return /^x([0-9]|[12][0-9]|3[01])$/.test(t);
}

function isImmediate(t) {
    return /^-?\d+$/.test(t) || /^0x[0-9a-fA-F]+$/.test(t);
}

function expectRegisters(op, arr) {
    for (let r of arr) {
        if (!isRegister(r)) {
            throw new Error(`Formato inválido en ${op}: se esperaba registro, se recibió '${r}'`);
        }
    }
}

function expectImmediate(op, imm) {
    if (!isImmediate(imm)) {
        throw new Error(`Formato inválido en ${op}: se esperaba inmediato, se recibió '${imm}'`);
    }
}

export function assembleProgram(text) {
    let lines = text.split(/\r?\n/);

    // ========================
    // 1) PRIMER PASO: ETIQUETAS
    // ========================
    let labels = {};
    let pc = 0;

    for (let raw of lines) {
        let line = raw.trim();
        if (!line) continue;

        if (line.endsWith(":")) {
            let name = line.replace(":", "");
            labels[name] = pc;
            continue;
        }

        pc += 4;  // Cada instrucción ocupa 4 bytes
    }

    // ========================
    // 2) SEGUNDO PASO: ENSAMBLAR
    // ========================
    pc = 0;
    const out = [];

    for (let raw of lines) {
        let line = raw.trim();
        if (!line || line.startsWith("#") || line.startsWith("//")) continue;
        if (line.endsWith(":")) continue; // Ya procesada

        let p = line.replace(/,/g, " ").replace(/\(/g, " ").replace(/\)/g, " ").split(/\s+/);
        let op = p[0];

        // ---------- TIPO R ----------
        // ---------- TIPO R ----------
        if (["add", "sub", "and", "or", "xor", "sll", "srl", "sra"].includes(op)) {

            expectRegisters(op, [p[1], p[2], p[3]]);

            const functMap = {
                add: [0x00, 0x0],
                sub: [0x20, 0x0],
                and: [0x00, 0x7],
                or: [0x00, 0x6],
                xor: [0x00, 0x4],
                sll: [0x00, 0x1],
                srl: [0x00, 0x5],
                sra: [0x20, 0x5]
            };

            const [funct7, funct3] = functMap[op];
            out.push(R(funct7, funct3, 0x33, reg(p[1]), reg(p[2]), reg(p[3])));
        }

        // ---------- TIPO I ----------
        else if (["addi", "andi", "ori", "xori", "slti", "slli", "srli", "srai"].includes(op)) {

            expectRegisters(op, [p[1], p[2]]);
            expectImmediate(op, p[3]);

            const functMap = {
                addi: 0x0,
                andi: 0x7,
                ori: 0x6,
                xori: 0x4,
                slti: 0x2,
                slli: 0x1,
                srli: 0x5,
                srai: 0x5
            };

            let instr = I(functMap[op], 0x13, reg(p[1]), reg(p[2]), parseInt(p[3]));

            if (op === "srai") instr |= (0x20 << 25);

            out.push(instr);
        }

        // ---------- LOAD ----------
        else if (op === "lw") {

            expectRegisters(op, [p[1], p[3]]);
            expectImmediate(op, p[2]);

            out.push(I(0x2, 0x03, reg(p[1]), reg(p[3]), parseInt(p[2])));
        }

        // ---------- STORE ----------
        else if (op === "sw") {

            expectRegisters(op, [p[1], p[3]]);
            expectImmediate(op, p[2]);

            out.push(S(0x2, 0x23, reg(p[3]), reg(p[1]), parseInt(p[2])));
        }


        // ---------- BRANCH CON ETIQUETAS ----------
else if (["beq","bne","blt","bge","bltu","bgeu"].includes(op)) {

    // Validar registros
    if (!isRegister(p[1]) || !isRegister(p[2])) {
        throw new Error(`Formato inválido: ${op} rs1, rs2, label`);
    }

    const label = p[3];

    // Validar etiqueta
    if (!(label in labels)) {
        throw new Error(`Etiqueta no definida: ${label}`);
    }

    const rs1 = reg(p[1]);
    const rs2 = reg(p[2]);

    const targetAddr = labels[label];
    const offset = targetAddr - pc;

    const funct3Map = {
        beq: 0x0,
        bne: 0x1,
        blt: 0x4,
        bge: 0x5,
        bltu: 0x6,
        bgeu: 0x7
    };

    out.push(B(funct3Map[op], 0x63, rs1, rs2, offset));
}

        else console.warn("Instrucción desconocida:", line);

        pc += 4;
    }

    return out.map(x => x >>> 0);
}