export function controlUnit({ opcode, funct3, funct7 }) {
    let alu_src = 0;
    let alu2reg = 0;
    let wem = 0;
    let branch = 0;
    let branch_ne = 0;
    let alu_op = 0; // 4 bits como tu unidad_control

    if (opcode === 0x33) {
        // R-type
        alu_src = 0;
        alu2reg = 0;
        wem = 0;
        branch = 0;
        switch (funct3) {
            case 0x0:
                if (funct7 === 0x20) alu_op = 0x1; // SUB
                else alu_op = 0x0; // ADD
                break;
            case 0x7:
                alu_op = 0x9; // AND
                break;
            case 0x6:
                alu_op = 0x8; // OR
                break;
            case 0x4:
                alu_op = 0x5; // XOR
                break;
            case 0x2:
                alu_op = 0x3; // SLT
                break;
            case 0x3:
                alu_op = 0x4; // SLTU
                break;
            case 0x1:
                alu_op = 0x2; // SLL
                break;
            case 0x5:
                if (funct7 === 0x20) alu_op = 0x7; // SRA
                else alu_op = 0x6; // SRL
                break;
        }
    } else if (opcode === 0x13) {
        // I-type ALU
        alu_src = 1;
        alu2reg = 0;
        wem = 0;
        branch = 0;
        switch (funct3) {
            case 0x0:
                alu_op = 0x0; // ADDI
                break;
            case 0x2:
                alu_op = 0x3; // SLTI
                break;
            case 0x3:
                alu_op = 0x4; // SLTIU
                break;
            case 0x4:
                alu_op = 0x5; // XORI
                break;
            case 0x6:
                alu_op = 0x8; // ORI
                break;
            case 0x7:
                alu_op = 0x9; // ANDI
                break;
            case 0x1:
                alu_op = 0x2; // SLLI
                break;
            case 0x5:
                if (funct7 === 0x20) alu_op = 0x7; // SRAI
                else alu_op = 0x6; // SRLI
                break;
        }
    } else if (opcode === 0x03) {
        // LOAD (LW)
        alu_src = 1;
        alu_op = 0x0; // ADD
        alu2reg = 1;
        wem = 0;
        branch = 0;
    } else if (opcode === 0x23) {
        // STORE (SW)
        alu_src = 1;
        alu_op = 0x0; // ADD
        alu2reg = 0;
        wem = 1;
        branch = 0;
    } else if (opcode === 0x63) {
        // BRANCH
        alu_src = 0;
        alu2reg = 0;
        wem = 0;
        branch = 1;
        switch (funct3) {
            case 0x0: // BEQ
                alu_op = 0xb;
                branch_ne = 0;
                break;
            case 0x1: // BNE
                alu_op = 0xb;
                branch_ne = 1;
                break;
            case 0x4: // BLT
                alu_op = 0x3;
                branch_ne = 0;
                break;
            case 0x5: // BGE
                alu_op = 0x3;
                branch_ne = 1;
                break;
            case 0x6: // BLTU
                alu_op = 0x4;
                branch_ne = 0;
                break;
            case 0x7: // BGEU
                alu_op = 0x4;
                branch_ne = 1;
                break;
        }
    }

    return { alu_src, alu2reg, wem, branch, branch_ne, alu_op };
}
