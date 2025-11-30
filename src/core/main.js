import { RISCVProcessor, Stage } from './cpu.js';
import { toHex32 } from './utils.js';

const cpu = new RISCVProcessor();
let runInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    console.log("RISC-V Simulator Initialized");

    // Initial UI Render
    updateUI();

    // Event Listeners
    document.getElementById('btn-step').addEventListener('click', handleStep);
    document.getElementById('btn-run').addEventListener('click', handleRun);
    document.getElementById('btn-reset').addEventListener('click', handleReset);
    document.getElementById('btn-load').addEventListener('click', handleLoad);

    // Load default program
    const defaultProgram = document.getElementById('program-input').placeholder;
    // cpu.loadProgram(defaultProgram); // Optional: Load placeholder program on start
});

function handleStep() {
    const result = cpu.step(updateStageIndicator);
    if (result) {
        updateUI(result);
    } else {
        console.log("CPU Halted");
    }
}

function handleRun(e) {
    const btn = e.target.closest('button'); // Handle click on span
    const span = btn.querySelector('span');

    if (runInterval) {
        clearInterval(runInterval);
        runInterval = null;
        span.textContent = "Run";
        btn.classList.remove('active'); // Optional style
        return;
    }

    span.textContent = "Pause";
    btn.classList.add('active');

    runInterval = setInterval(() => {
        if (cpu.state.halted) {
            clearInterval(runInterval);
            runInterval = null;
            span.textContent = "Run";
            btn.classList.remove('active');
        } else {
            const result = cpu.step(updateStageIndicator);
            if (result) {
                updateUI(result);
            }
        }
    }, 600); // 600ms delay as in reference
}

function handleReset() {
    if (runInterval) {
        clearInterval(runInterval);
        runInterval = null;
        const btn = document.getElementById('btn-run');
        btn.querySelector('span').textContent = "Run";
    }
    cpu.reset();
    updateUI();
    // Reset stage indicators
    document.querySelectorAll('.stage-pill').forEach(el => el.classList.remove('active'));
}

function handleLoad() {
    const code = document.getElementById('program-input').value;
    if (!code) return;
    cpu.loadProgram(code);
    updateUI();
    alert("Programa cargado exitosamente.");
}

function updateStageIndicator(stage) {
    // Remove active class from all
    document.querySelectorAll('.stage-pill').forEach(el => el.classList.remove('active'));

    // Add active class to current
    const idMap = {
        [Stage.FETCH]: 'stage-fetch',
        [Stage.DECODE]: 'stage-decode',
        [Stage.EXEC]: 'stage-exec',
        [Stage.MEM]: 'stage-mem',
        [Stage.WB]: 'stage-wb'
    };

    const el = document.getElementById(idMap[stage]);
    if (el) el.classList.add('active');
}

function updateUI(stepResult) {
    // Update Status Bar
    document.getElementById('ui-pc').textContent = toHex32(cpu.state.pc);
    document.getElementById('ui-cycle').textContent = cpu.state.cycle;

    // Update Registers
    renderRegisters();

    // Update Decode Info
    if (stepResult && stepResult.decoded) {
        const { decoded, ctrl } = stepResult;
        document.getElementById('info-opcode').textContent = "0x" + decoded.opcode.toString(16).padStart(2, "0");
        document.getElementById('info-funct3').textContent = "0x" + decoded.funct3.toString(16);
        document.getElementById('info-funct7').textContent = "0x" + decoded.funct7.toString(16).padStart(2, "0");
        document.getElementById('info-imm').textContent = decoded.immType ? `${decoded.imm} (${decoded.immType})` : "--";
    } else {
        // Clear info if reset
        document.getElementById('info-opcode').textContent = "--";
        document.getElementById('info-funct3').textContent = "--";
        document.getElementById('info-funct7').textContent = "--";
        document.getElementById('info-imm').textContent = "--";
    }
}

function renderRegisters() {
    const tbody = document.querySelector('#registers-table tbody');
    tbody.innerHTML = '';

    for (let i = 0; i < 32; i++) {
        const tr = document.createElement('tr');
        const regName = `x${i}`;
        let alias = regName;
        // Simple alias mapping
        if (i === 0) alias = 'zero';
        else if (i === 1) alias = 'ra';
        else if (i === 2) alias = 'sp';
        else if (i === 3) alias = 'gp';
        else if (i === 4) alias = 'tp';

        const valHex = toHex32(cpu.state.regs[i]);
        const valDec = (cpu.state.regs[i] | 0).toString(); // Signed

        tr.innerHTML = `
            <td>${regName}</td>
            <td style="color: #94a3b8">${alias}</td>
            <td style="font-family: 'JetBrains Mono'">${valHex}</td>
            <td style="font-family: 'JetBrains Mono'; color: #94a3b8">${valDec}</td>
        `;
        tbody.appendChild(tr);
    }
}
