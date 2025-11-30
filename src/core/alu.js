export function alu(a, b, alu_op) {
    a = a | 0;
    b = b | 0;
    let res = 0;

    switch (alu_op) {
        case 0x0: // ADD
            res = (a + b) | 0;
            break;
        case 0x1: // SUB
            res = (a - b) | 0;
            break;
        case 0x2: // SLL
            res = a << (b & 0x1f);
            break;
        case 0x3: // SLT (signed)
            res = a < b ? 1 : 0;
            break;
        case 0x4: // SLTU (unsigned)
            res = (a >>> 0) < (b >>> 0) ? 1 : 0;
            break;
        case 0x5: // XOR
            res = a ^ b;
            break;
        case 0x6: // SRL
            res = a >>> (b & 0x1f);
            break;
        case 0x7: // SRA
            res = a >> (b & 0x1f);
            break;
        case 0x8: // OR
            res = a | b;
            break;
        case 0x9: // AND
            res = a & b;
            break;
        case 0xa: // SEQ
            res = a === b ? 1 : 0;
            break;
        case 0xb: // "BEQ comparator"
            res = a === b ? 1 : 0;
            break;
        case 0xc: // BLT signed comparator
            res = a < b ? 1 : 0;
            break;
        case 0xd: // BLTU unsigned
            res = (a >>> 0) < (b >>> 0) ? 1 : 0;
            break;
        default:
            res = 0;
    }

    return res >>> 0;
}
