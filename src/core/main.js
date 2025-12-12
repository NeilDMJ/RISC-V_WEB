/* ============================================================
   IMPORTS Y ESTADO
============================================================ */
import { RISCVProcessor, Stage } from './cpu.js';
import { toHex32 } from './utils.js';
import { assembleProgram } from './utils.js';

let lastDecoded = null;
const cpu = new RISCVProcessor();
let runInterval = null;

/* ============================================================
   INICIO
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    loadDatapathSVG();
    updateUI();

    document.getElementById('btn-step').addEventListener('click', handleStep);
    document.getElementById('btn-run').addEventListener('click', handleRun);
    document.getElementById('btn-reset').addEventListener('click', handleReset);
    document.getElementById('btn-load').addEventListener('click', handleLoad);
    document.getElementById('btn-fullscreen').addEventListener('click', handleFullscreen);
});

/* ============================================================
   CARGAR SVG DEL DATAPATH
============================================================ */
async function loadDatapathSVG() {
    try {
        const response = await fetch('procesador.svg');
        const svgText = await response.text();
        
        const container = document.getElementById('datapath-container');
        container.innerHTML = svgText;
        
        // Ajustar el SVG al contenedor
        const svg = container.querySelector('svg');
        if (svg) {
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.position = 'relative';
            svg.style.zIndex = '2';
        }
    } catch (error) {
        console.error('Error cargando el SVG del datapath:', error);
    }
}

/* ============================================================
   STEP
============================================================ */
let isStepInProgress = false;

async function handleStep() {
    if (isStepInProgress) return;
    isStepInProgress = true;

    const result = await cpu.stepWithStageDelay(updateStageIndicator, 400);
    if (result) updateUI(result);
    
    isStepInProgress = false;
}

/* ============================================================
   RUN / PAUSE
============================================================ */
let isRunning = false;

async function handleRun(e) {
    const btn = e.target.closest('button');
    const span = btn.querySelector('span');

    if (isRunning) {
        isRunning = false;
        span.textContent = "Run";
        btn.classList.remove("active");
        return;
    }

    btn.classList.add("active");
    span.textContent = "Pause";
    isRunning = true;

    while (isRunning && !cpu.state.halted) {
        const result = await cpu.stepWithStageDelay(updateStageIndicator, 300);
        if (result) updateUI(result);
        // Pequeña pausa entre instrucciones completas
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (cpu.state.halted || !isRunning) {
        isRunning = false;
        btn.classList.remove("active");
        span.textContent = "Run";
    }
}

/* ============================================================
   RESET
============================================================ */
function handleReset() {
    isRunning = false;
    isStepInProgress = false;
    
    const runBtn = document.getElementById('btn-run');
    runBtn.querySelector('span').textContent = "Run";
    runBtn.classList.remove('active');

    lastDecoded = null;
    cpu.reset();
    updateUI();

    document.querySelectorAll('.stage-pill').forEach(el => el.classList.remove('active'));
}

/* ============================================================
   LOAD PROGRAM
============================================================ */
function handleLoad() {
    const code = document.getElementById('program-input').value.trim();
    if (!code) return;

    let program;

    if (/^[0-9a-fA-F]+$/.test(code.split("\n")[0].trim())) {
        program = code;
    } else {
        const hexArray = assembleProgram(code);
        program = hexArray.map(x => x.toString(16).padStart(8, "0")).join("\n");
    }

    lastDecoded = null;
    cpu.loadProgram(program);
    updateUI();
    alert("Programa cargado exitosamente.");
}

/* ============================================================
   FULLSCREEN
============================================================ */
function handleFullscreen() {
    const section = document.getElementById('datapath-section');

    if (!document.fullscreenElement) {
        section.classList.add('fullscreen');
        section.requestFullscreen?.();
    } else {
        document.exitFullscreen?.();
    }
}

document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement)
        document.getElementById('datapath-section').classList.remove('fullscreen');
});

/* ============================================================
   STAGE INDICATOR
============================================================ */
function updateStageIndicator(stage) {
    // Actualizar pills
    document.querySelectorAll('.stage-pill').forEach(el => el.classList.remove('active'));

    const ids = {
        [Stage.FETCH]: 'stage-fetch',
        [Stage.DECODE]: 'stage-decode',
        [Stage.EXEC]: 'stage-exec',
        [Stage.MEM]: 'stage-mem',
        [Stage.WB]: 'stage-wb'
    };

    const el = document.getElementById(ids[stage]);
    if (el) el.classList.add("active");
    
    // Iluminar componentes del datapath
    illuminateDatapathComponents(stage);
}

/* ============================================================
   ILUMINAR COMPONENTES DEL DATAPATH SEGÚN ETAPA
============================================================ */
function illuminateDatapathComponents(stage) {
    // Limpiar todas las clases active del SVG
    const svg = document.querySelector('#datapath-container svg');
    if (!svg) return;
    
    svg.querySelectorAll('.active').forEach(el => el.classList.remove('active'));
    
    // Definir qué componentes se iluminan en cada etapa
    const stageComponents = {
        [Stage.FETCH]: [
            '#pc',
            '#instr-mem',
            '#pc-adder',
            '#path57', '#path58', '#path59', // Líneas de PC
            'path[id^="bus-pc"]'
        ],
        [Stage.DECODE]: [
            '#instr-mem',
            '#control-unit',
            '#registers',
            '#sign-extend',
            'path[id^="path50"]',
            'path[id^="path51"]',
            'path[id^="imm"]'
        ],
        [Stage.EXEC]: [
            '#alu',
            '#mux-alu-a',
            '#registers',
            '#sign-extend',
            'path[id^="path3"]',
            'path[id^="path81"]',
            '#alu-op'
        ],
        [Stage.MEM]: [
            '#data-mem',
            '#alu',
            'path[id^="path78"]', // ALU output
            'path[id^="path82"]', // Dir output
            'path[id^="path84"]', // Dir input
            'path[id^="path80"]', // Input data
            '#wem'
        ],
        [Stage.WB]: [
            '#mux-wb',
            '#data-mem',
            '#registers',
            'path[id^="alu-reg"]',
            '#alu2reg',
            '#wer'
        ]
    };
    
    // Obtener componentes para la etapa actual
    const componentsToIlluminate = stageComponents[stage] || [];
    
    // Iluminar cada componente
    componentsToIlluminate.forEach(selector => {
        const elements = svg.querySelectorAll(selector);
        elements.forEach(el => {
            el.classList.add('active');
        });
    });
}

/* ============================================================
   ILUMINAR SOLO LOS CAMPOS QUE CAMBIAN
============================================================ */
function highlightDecodeOnlyOnChange(decoded) {
    if (!decoded) return;

    const colors = {
        "info-opcode": "#3b82f6",  // Azul
        "info-rd":     "#22c55e",  // Verde
        "info-rs1":    "#f97316",  // Naranja
        "info-rs2":    "#eab308",  // Amarillo
        "info-funct3": "#a855f7",  // Morado
        "info-funct7": "#ec4899",  // Rosa
        "info-imm":    "#38bdf8"   // Celeste
    };

    const opcode = decoded.opcode;

    const isR = opcode === 0x33;
    const isI = opcode === 0x13 || opcode === 0x03;
    const isS = opcode === 0x23;
    const isB = opcode === 0x63;

    const fields = ["info-opcode"];

    if (isR) fields.push("info-rd","info-rs1","info-rs2","info-funct3","info-funct7");
    if (isI) fields.push("info-rd","info-rs1","info-funct3","info-imm");
    if (isS) fields.push("info-rs1","info-rs2","info-funct3","info-imm");
    if (isB) fields.push("info-rs1","info-rs2","info-funct3","info-imm");

    // Si NO cambia la instrucción → NO iluminar
    if (lastDecoded && JSON.stringify(lastDecoded) === JSON.stringify(decoded))
        return;

    lastDecoded = decoded;

    // limpiar
    document.querySelectorAll(".decode-item").forEach(el => {
        el.classList.remove("decode-highlight");
        el.style.boxShadow = "";
        el.style.borderColor = "";
    });

    // iluminar SOLO los usados
    fields.forEach(id => {
        const item = document.getElementById(id)?.closest(".decode-item");
        if (!item) return;

        item.classList.add("decode-highlight");
        item.style.boxShadow = `0 0 12px ${colors[id]}`;
        item.style.borderColor = colors[id];

        setTimeout(() => {
            item.classList.remove("decode-highlight");
            item.style.boxShadow = "";
            item.style.borderColor = "";
        }, 250);
    });
}

/* ============================================================
   UI UPDATES
============================================================ */
function updateUI(stepResult) {
    document.getElementById('ui-pc').textContent = toHex32(cpu.state.pc);
    document.getElementById('ui-cycle').textContent = cpu.state.cycle;

    renderRegisters();

    if (stepResult?.decoded) {
        const d = stepResult.decoded;

        document.getElementById('info-opcode').textContent = "0x" + d.opcode.toString(16).padStart(2,"0");
        document.getElementById('info-rd').textContent     = d.rd !== undefined ? `x${d.rd}` : "--";
        document.getElementById('info-rs1').textContent    = d.rs1 !== undefined ? `x${d.rs1}` : "--";
        document.getElementById('info-rs2').textContent    = d.rs2 !== undefined ? `x${d.rs2}` : "--";
        document.getElementById('info-funct3').textContent = "0x" + d.funct3.toString(16);
        document.getElementById('info-funct7').textContent = "0x" + d.funct7.toString(16).padStart(2,"0");
        document.getElementById('info-imm').textContent    = d.imm ?? "--";

        highlightDecodeOnlyOnChange(d);
    }
}

/* ============================================================
   RENDER REGISTERS (EDITABLES)
============================================================ */
function renderRegisters() {
    const tbody = document.querySelector('#registers-table tbody');
    tbody.innerHTML = "";

    for (let i = 0; i < 32; i++) {
        const regVal = cpu.state.regs[i] >>> 0;  // valor real
        const hexVal = toHex32(regVal);          // valor en hexadecimal

        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td>x${i}</td>
            <td style="font-family: 'JetBrains Mono'">${hexVal}</td>
            <td>
                <input 
                    type="text" 
                    class="reg-dec-input" 
                    data-reg="${i}" 
                    value="${regVal}" 
                    style="width: 100%; background: transparent; color: white; border: 1px solid #334155; border-radius: 4px;"
                >
            </td>
        `;

        // Actualizar registro cuando escriban en el input
        tr.querySelector("input").addEventListener("change", e => {
            let val = parseInt(e.target.value);
            if (i === 0) val = 0;          // x0 siempre es 0
            if (Number.isNaN(val)) val = 0;
            cpu.state.regs[i] = val >>> 0;
            renderRegisters();
        });

        tbody.appendChild(tr);
    }
}
