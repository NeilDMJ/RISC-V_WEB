
import { RISCVProcessor, Stage } from './cpu.js';
import { toHex32, toInt32, signExtend, assembleProgram } from './utils.js';

let lastDecoded = null;
let currentDecoded = null; // Para actualizar cuando cambia el formato
const cpu = new RISCVProcessor();
let runInterval = null;
let displayFormat = 'dec'; // 'hex', 'dec', 'bin'
let executionDelay = 600; // Delay en ms entre ciclos de ejecución
let currentMemoryView = 'grid'; // 'grid' o 'table'
let lastStepResult = null; // Almacenar último resultado para tooltips

// Animación datapath (SVG)
let dpAnim = {
    svg: null,
    packetLayer: null,
    valueLayer: null,
    movers: [],
    tickerId: null,
    pathPointCache: new WeakMap(),
};

function getCachedPoint(pathEl, totalLen, t) {
    // Cache de puntos muestreados para reducir costo de getPointAtLength()
    // t: 0..1
    const cached = dpAnim.pathPointCache.get(pathEl);
    if (cached && cached.totalLen === totalLen) {
        const idx = Math.max(0, Math.min(cached.points.length - 1, Math.round(t * (cached.points.length - 1))));
        return cached.points[idx];
    }

    // Muestreo: suficiente para movimiento suave sin ser caro
    const samples = 140;
    const points = new Array(samples);
    for (let i = 0; i < samples; i++) {
        const lt = (i / (samples - 1)) * totalLen;
        const p = pathEl.getPointAtLength(lt);
        points[i] = { x: p.x, y: p.y };
    }
    dpAnim.pathPointCache.set(pathEl, { totalLen, points });

    const idx = Math.max(0, Math.min(samples - 1, Math.round(t * (samples - 1))));
    return points[idx];
}

function startDatapathTicker() {
    if (dpAnim.tickerId != null) return;

    const tick = (now) => {
        // Si no hay animaciones vivas, apagar el ticker
        if (!dpAnim.movers.length) {
            dpAnim.tickerId = null;
            return;
        }

        const easeOutQuad = (t) => 1 - Math.pow(1 - t, 2);

        const alive = [];
        for (const m of dpAnim.movers) {
            const t = Math.min(1, (now - m.start) / m.durationMs);
            const eased = easeOutQuad(t);

            const tt = m.reverse ? (1 - eased) : eased;

            // Evitar getPointAtLength por frame: usar puntos cacheados
            const p = getCachedPoint(m.pathEl, m.totalLen, tt);
            if (m.kind === 'circle') {
                m.el.setAttribute('cx', String(p.x));
                m.el.setAttribute('cy', String(p.y));
            } else {
                m.el.setAttribute('transform', `translate(${p.x}, ${p.y + (m.yOffset || 0)})`);
            }

            if (t < 1) {
                alive.push(m);
            } else {
                m.el.remove();
            }
        }
        dpAnim.movers = alive;
        dpAnim.tickerId = requestAnimationFrame(tick);
    };

    dpAnim.tickerId = requestAnimationFrame(tick);
}

function addMover(mover) {
    dpAnim.movers.push(mover);
    startDatapathTicker();
}

// ABI names para los registros
const ABI_NAMES = [
    'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
    's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
    'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
    's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'
];

/* ============================================================
   INICIO
============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    loadDatapathSVG();
    updateUI();
    createBusTooltip();
    createModuleVisor();

    // Event listeners seguros (verifica que el elemento existe antes de agregar listener)
    const btnStep = document.getElementById('btn-step');
    const btnRun = document.getElementById('btn-run');
    const btnReset = document.getElementById('btn-reset');
    const btnLoad = document.getElementById('btn-load');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const btnInfo = document.getElementById('btn-info');
    const btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');
    const btnPreloadCollatz = document.getElementById('btn-preload-collatz');
    const btnPreloadFibonacci = document.getElementById('btn-preload-fibonacci');

    if (btnStep) btnStep.addEventListener('click', handleStep);
    if (btnRun) btnRun.addEventListener('click', handleRun);
    if (btnReset) btnReset.addEventListener('click', handleReset);
    if (btnLoad) btnLoad.addEventListener('click', handleLoad);
    if (btnFullscreen) btnFullscreen.addEventListener('click', handleFullscreen);
    if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', toggleSidebar);
    if (btnInfo) btnInfo.addEventListener('click', () => { window.location.href = 'contact.html'; });
    if (btnCollapseSidebar) btnCollapseSidebar.addEventListener('click', toggleSidebar);
    if (btnPreloadCollatz) btnPreloadCollatz.addEventListener('click', () => loadPresetProgram('collatz'));
    if (btnPreloadFibonacci) btnPreloadFibonacci.addEventListener('click', () => loadPresetProgram('fibonacci'));
    
    // Configurar selector de formato
    setupFormatSelector();
    
    // Configurar control de velocidad
    setupSpeedControl();
    
    // Configurar toggle de vistas de memoria
    setupMemoryViewToggle();
});

function isWirePath(el) {
    if (!el || el.tagName?.toLowerCase() !== 'path') return false;
    const style = String(el.getAttribute('style') || '').toLowerCase();
    const fillAttr = String(el.getAttribute('fill') || '').toLowerCase();
    const hasNoFill = style.includes('fill:none') || fillAttr === 'none';
    const hasStroke = style.includes('stroke:') || el.hasAttribute('stroke');
    return hasNoFill && hasStroke;
}

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
        
        // Preparar clases para animaciones (no mueve geometría)
        prepareDatapathAnimations();

        // Configurar tooltips/hover para TODOS los cables después de marcar dp-wire
        setupBusTooltips();

        // Hover 3D + visor de contenido por módulo
        setupModuleHoverVisor();
    } catch (error) {
        console.error('Error cargando el SVG del datapath:', error);
    }
}

function prepareDatapathAnimations() {
    const svg = document.querySelector('#datapath-container svg');
    if (!svg) return;

    // Reiniciar ticker/animaciones previas (por si se recarga el SVG)
    if (dpAnim.tickerId != null) {
        cancelAnimationFrame(dpAnim.tickerId);
        dpAnim.tickerId = null;
    }
    dpAnim.movers = [];
    dpAnim.pathPointCache = new WeakMap();

    dpAnim.svg = svg;

    // Capa encima para paquetes (circles). No altera posiciones existentes.
    let layer = svg.querySelector('g#dp-packets');
    if (!layer) {
        layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layer.setAttribute('id', 'dp-packets');
        layer.setAttribute('pointer-events', 'none');
        // Insertar al final para que quede encima
        svg.appendChild(layer);
    }
    dpAnim.packetLayer = layer;

    // Capa encima para etiquetas numéricas (pill + texto). No altera posiciones.
    let vlayer = svg.querySelector('g#dp-values');
    if (!vlayer) {
        vlayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        vlayer.setAttribute('id', 'dp-values');
        vlayer.setAttribute('pointer-events', 'none');
        // Encima de paquetes para legibilidad
        svg.appendChild(vlayer);
    }
    dpAnim.valueLayer = vlayer;

    // Marcar cables reales (paths con fill:none) para aplicar estilos externos
    svg.querySelectorAll('path').forEach((p) => {
        if (isWirePath(p)) p.classList.add('dp-wire');
    });

    // Marcar módulos para aplicar “breathing glow” cuando estén activos
    const moduleIds = [
        'pc', 'instr-mem', 'control-unit', 'registers', 'data-mem',
        'alu', 'sign-extend', 'mux-wb', 'mux-alu-a', 'mux-imm', 'pc-adder'
    ];
    moduleIds.forEach(id => {
        const el = svg.querySelector('#' + CSS.escape(id));
        if (el) el.classList.add('dp-module');
    });
}

function spawnPacketOnPath(pathEl, { durationMs = 420, radius = 3.2, soft = false, reverse = false } = {}) {
    if (!dpAnim.svg || !dpAnim.packetLayer || !pathEl) return;
    if (typeof pathEl.getTotalLength !== 'function') return;

    let totalLen = 0;
    try {
        totalLen = pathEl.getTotalLength();
    } catch {
        return;
    }
    if (!Number.isFinite(totalLen) || totalLen <= 1) return;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', String(radius));
    circle.classList.add('dp-packet');
    if (soft) circle.classList.add('dp-packet-soft');
    dpAnim.packetLayer.appendChild(circle);

    addMover({
        kind: 'circle',
        el: circle,
        pathEl,
        totalLen,
        start: performance.now(),
        durationMs,
        yOffset: 0,
        reverse,
    });
}

function formatDecimal32(value) {
    if (value === null || value === undefined) return null;
    const u = value >>> 0;
    return String(toInt32(u));
}

function spawnValueTagOnPath(pathEl, value, { durationMs = 520, yOffset = -10, reverse = false } = {}) {
    if (!dpAnim.svg || !dpAnim.valueLayer || !pathEl) return;
    if (typeof pathEl.getTotalLength !== 'function') return;

    const label = formatDecimal32(value);
    if (!label) return;

    let totalLen = 0;
    try {
        totalLen = pathEl.getTotalLength();
    } catch {
        return;
    }
    if (!Number.isFinite(totalLen) || totalLen <= 1) return;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('dp-value-tag');

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.classList.add('dp-value-bg');
    bg.setAttribute('rx', '6');
    bg.setAttribute('ry', '6');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.classList.add('dp-value-text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = label;

    g.appendChild(bg);
    g.appendChild(text);
    dpAnim.valueLayer.appendChild(g);

    // Evitar getBBox(): fuerza layout/reflow y causa tirones.
    // Aproximación para monospace 11px: ~7px por carácter + padding.
    const padX = 8;
    const w = Math.max(18, label.length * 7 + padX * 2);
    const h = 18;
    bg.setAttribute('width', String(w));
    bg.setAttribute('height', String(h));
    bg.setAttribute('x', String(-w / 2));
    bg.setAttribute('y', String(-h / 2));
    text.setAttribute('x', '0');
    text.setAttribute('y', '0');

    addMover({
        kind: 'tag',
        el: g,
        pathEl,
        totalLen,
        start: performance.now(),
        durationMs,
        yOffset,
        reverse,
    });
}

function datapathPing(selector) {
    const svg = dpAnim.svg;
    if (!svg) return;
    const el = svg.querySelector(selector);
    if (!el) return;
    el.classList.add('dp-ping');
    setTimeout(() => el.classList.remove('dp-ping'), 350);
}

/* ============================================================
   BUS TOOLTIPS
============================================================ */
function createBusTooltip() {
    // Crear elemento tooltip si no existe
    if (document.getElementById('bus-tooltip')) return;
    
    const tooltip = document.createElement('div');
    tooltip.id = 'bus-tooltip';
    tooltip.className = 'bus-tooltip';
    tooltip.style.cssText = `
        position: fixed;
        background: rgba(15, 23, 42, 0.95);
        border: 2px solid #3b82f6;
        border-radius: 8px;
        padding: 8px 12px;
        color: #e2e8f0;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 13px;
        pointer-events: none;
        z-index: 10000;
        display: none;
        box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
        white-space: nowrap;
    `;
    document.body.appendChild(tooltip);
}

/* ============================================================
   MODULE VISOR (hover)
============================================================ */
let moduleVisorState = {
    visible: false,
    moduleId: null,
    x: 0,
    y: 0,
};

function isFlatHoverModuleId(id) {
    return id === 'sign-extend' || id === 'mux-wb' || id === 'mux-alu-a' || id === 'mux-imm';
}

function createModuleVisor() {
    if (document.getElementById('module-visor')) return;

    const visor = document.createElement('div');
    visor.id = 'module-visor';
    visor.className = 'module-visor';
    visor.style.display = 'none';
    visor.innerHTML = `
        <div class="module-visor-title" id="module-visor-title">--</div>
        <div class="module-visor-body" id="module-visor-body"></div>
    `;
    document.body.appendChild(visor);
}

function setupModuleHoverVisor() {
    const svg = document.querySelector('#datapath-container svg');
    if (!svg) return;

    if (!document.getElementById('module-visor')) createModuleVisor();

    const modules = svg.querySelectorAll('.dp-module');
    modules.forEach(mod => {
        mod.style.cursor = 'pointer';

        mod.addEventListener('pointerenter', (e) => {
            moduleVisorState.visible = true;
            moduleVisorState.moduleId = mod.id;
            moduleVisorState.x = e.clientX;
            moduleVisorState.y = e.clientY;
            mod.classList.remove('dp-hovered');
            // Para módulos delgados, NO aplicar ningún efecto 3D/hover visual.
            // Solo mostrar el visor (card).
            if (!isFlatHoverModuleId(mod.id)) mod.classList.add('dp-hovered');
            showModuleVisor();
            moveModuleVisor(e);
            refreshModuleVisor();
        });

        mod.addEventListener('pointermove', (e) => {
            if (!moduleVisorState.visible || moduleVisorState.moduleId !== mod.id) return;
            moduleVisorState.x = e.clientX;
            moduleVisorState.y = e.clientY;
            moveModuleVisor(e);
            updateModuleTilt(mod, e);
        });

        mod.addEventListener('pointerleave', () => {
            moduleVisorState.visible = false;
            moduleVisorState.moduleId = null;
            mod.classList.remove('dp-hovered');
            mod.style.removeProperty('--dp-tilt-x');
            mod.style.removeProperty('--dp-tilt-y');
            hideModuleVisor();
        });
    });
}

function showModuleVisor() {
    const visor = document.getElementById('module-visor');
    if (!visor) return;
    visor.style.display = 'block';
}

function hideModuleVisor() {
    const visor = document.getElementById('module-visor');
    if (!visor) return;
    visor.style.display = 'none';
}

function moveModuleVisor(e) {
    const visor = document.getElementById('module-visor');
    if (!visor) return;

    const pad = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // posicion inicial
    let left = e.clientX + 14;
    let top = e.clientY + 14;

    // medir para clamp
    visor.style.left = '0px';
    visor.style.top = '0px';
    const r = visor.getBoundingClientRect();

    if (left + r.width + pad > vw) left = Math.max(pad, e.clientX - r.width - 14);
    if (top + r.height + pad > vh) top = Math.max(pad, e.clientY - r.height - 14);

    visor.style.left = `${left}px`;
    visor.style.top = `${top}px`;
}

function updateModuleTilt(mod, e) {
    if (!mod || typeof mod.getBoundingClientRect !== 'function') return;

    // Componentes delgados: evitar tilt 3D (se distorsiona visualmente)
    if (isFlatHoverModuleId(mod.id)) return;

    const rect = mod.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = rect.width > 0 ? (e.clientX - cx) / (rect.width / 2) : 0;
    const dy = rect.height > 0 ? (e.clientY - cy) / (rect.height / 2) : 0;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const ndx = clamp(dx, -1, 1);
    const ndy = clamp(dy, -1, 1);

    // tilt suave
    const tiltY = ndx * 10; // rotateY
    const tiltX = -ndy * 8; // rotateX

    mod.style.setProperty('--dp-tilt-x', `${tiltX.toFixed(2)}deg`);
    mod.style.setProperty('--dp-tilt-y', `${tiltY.toFixed(2)}deg`);
}

function fmt32(v) {
    if (v === null || v === undefined) return '--';
    const u = (v >>> 0);
    return `${toHex32(u)} (${toInt32(u)})`;
}

function fmtReg(n) {
    if (n === null || n === undefined) return '--';
    const abi = ABI_NAMES[n] ? `/${ABI_NAMES[n]}` : '';
    return `x${n}${abi}`;
}

function getModuleVisorData(moduleId) {
    const sr = lastStepResult;
    const d = sr?.decoded;
    const c = sr?.ctrl;

    const pc_before = sr?.pc_before ?? cpu.state.pc;
    const pc_after = sr?.pc_after ?? cpu.state.pc;

    const common = {
        pc_before,
        pc_after,
        instr: sr?.instr,
    };

    switch (moduleId) {
        case 'pc':
            return {
                title: 'PC',
                rows: [
                    ['PC (before)', fmt32(common.pc_before)],
                    ['PC + 4', fmt32((common.pc_before + 4) >>> 0)],
                    ['PC (after)', fmt32(common.pc_after)],
                ]
            };

        case 'pc-adder':
            return {
                title: 'PC + 4',
                rows: [
                    ['PC', fmt32(common.pc_before)],
                    ['PC + 4', fmt32((common.pc_before + 4) >>> 0)],
                ]
            };

        case 'instr-mem': {
            const instr = common.instr ?? (() => {
                const wi = (cpu.state.pc >>> 2);
                if (wi >= cpu.state.instrMem.length) return null;
                return cpu.state.instrMem[wi] >>> 0;
            })();
            const wordIndex = (common.pc_before >>> 2);
            return {
                title: 'Instruction Memory',
                rows: [
                    ['PC', fmt32(common.pc_before)],
                    ['Index', `${wordIndex}`],
                    ['Instr', instr == null ? '--' : toHex32(instr)],
                    ['opcode', d ? `0x${d.opcode.toString(16).toUpperCase().padStart(2, '0')}` : '--'],
                ]
            };
        }

        case 'control-unit':
            return {
                title: 'Control Unit',
                rows: [
                    ['opcode', d ? `0x${d.opcode.toString(16).toUpperCase().padStart(2, '0')}` : '--'],
                    ['funct3', d ? `0x${d.funct3.toString(16).toUpperCase()}` : '--'],
                    ['funct7', d ? `0x${d.funct7.toString(16).toUpperCase().padStart(2, '0')}` : '--'],
                    ['alu_op', c ? `0x${c.alu_op.toString(16).toUpperCase()}` : '--'],
                    ['alu_src', c ? String(c.alu_src) : '--'],
                    ['alu2reg', c ? String(c.alu2reg) : '--'],
                    ['wem', c ? String(c.wem) : '--'],
                    ['branch', c ? String(c.branch) : '--'],
                    ['branch_ne', c ? String(c.branch_ne) : '--'],
                ]
            };

        case 'sign-extend':
            return {
                title: 'Sign Extend',
                rows: [
                    ['immType', d?.immType ?? '--'],
                    ['imm', d ? fmt32(d.imm >>> 0) : '--'],
                ]
            };

        case 'registers': {
            const rs1 = d?.rs1;
            const rs2 = d?.rs2;
            const rd = d?.rd;
            const rs1v = (sr?.rs1_val ?? (rs1 != null ? (cpu.state.regs[rs1] >>> 0) : null));
            const rs2v = (sr?.rs2_val ?? (rs2 != null ? (cpu.state.regs[rs2] >>> 0) : null));

            const wb = sr?.wb_we ? `${fmtReg(sr.wb_rd)} = ${fmt32(sr.wb_val)}` : '--';
            return {
                title: 'Register File',
                rows: [
                    ['rs1', rs1 == null ? '--' : fmtReg(rs1)],
                    ['rs1_val', fmt32(rs1v)],
                    ['rs2', rs2 == null ? '--' : fmtReg(rs2)],
                    ['rs2_val', fmt32(rs2v)],
                    ['rd', rd == null ? '--' : fmtReg(rd)],
                    ['writeback', wb],
                ]
            };
        }

        case 'alu':
            return {
                title: 'ALU',
                rows: [
                    ['A (rs1)', fmt32(sr?.rs1_val)],
                    ['B', fmt32(sr?.alu_b)],
                    ['alu_op', c ? `0x${c.alu_op.toString(16).toUpperCase()}` : '--'],
                    ['result', fmt32(sr?.alu_res)],
                ]
            };

        case 'data-mem': {
            const addr = sr?.mem_addr ?? sr?.alu_res;
            const idx = addr != null ? ((addr >>> 2) & 0x1f) : null;
            const memVal = idx != null ? (cpu.state.dataMem[idx] >>> 0) : null;

            let op = '--';
            if (d?.opcode === 0x03) op = 'LOAD';
            if (d?.opcode === 0x23 || c?.wem) op = 'STORE';

            return {
                title: 'Data Memory',
                rows: [
                    ['op', op],
                    ['addr', fmt32(addr)],
                    ['index', idx == null ? '--' : String(idx)],
                    ['write_data', op === 'STORE' ? fmt32(sr?.rs2_val) : '--'],
                    ['read_data', op === 'LOAD' ? fmt32(sr?.mem_data) : '--'],
                    ['mem[index]', fmt32(memVal)],
                ]
            };
        }

        default:
            return {
                title: moduleId || 'Module',
                rows: [
                    ['PC', fmt32(cpu.state.pc)],
                    ['Cycle', String(cpu.state.cycle)],
                ]
            };
    }
}

function refreshModuleVisor() {
    if (!moduleVisorState.visible || !moduleVisorState.moduleId) return;
    const visor = document.getElementById('module-visor');
    const titleEl = document.getElementById('module-visor-title');
    const bodyEl = document.getElementById('module-visor-body');
    if (!visor || !titleEl || !bodyEl) return;

    const data = getModuleVisorData(moduleVisorState.moduleId);
    titleEl.textContent = data.title;

    bodyEl.innerHTML = data.rows.map(([k, v]) => {
        const safeK = String(k);
        const safeV = String(v);
        return `<div class="module-visor-row"><span class="module-visor-k">${safeK}</span><code class="module-visor-v">${safeV}</code></div>`;
    }).join('');
}

function setupBusTooltips() {
    const svg = document.querySelector('#datapath-container svg');
    if (!svg) return;
    
    // Seleccionar SOLO cables reales (evita que shapes como MUXes se traten como buses)
    const buses = Array.from(svg.querySelectorAll('path')).filter(isWirePath);
    const tooltip = document.getElementById('bus-tooltip');
    if (!tooltip) createBusTooltip();
    
    buses.forEach(bus => {
        // Asegurar clase base para estilos
        bus.classList.add('dp-wire');

        bus.addEventListener('pointerenter', (e) => {
            bus.classList.add('dp-wire-hover');
            showBusTooltip(e, bus);
        });
        bus.addEventListener('pointermove', (e) => moveBusTooltip(e));
        bus.addEventListener('pointerleave', () => {
            bus.classList.remove('dp-wire-hover');
            hideBusTooltip();
        });
        bus.style.cursor = 'pointer';
    });
}

function getBusValue(busId, stepResultOverride = null) {
    const sr = stepResultOverride || lastStepResult;
    if (!sr) {
        return { label: busId, value: null, hint: 'Ejecuta Step/Run para ver datos' };
    }

    const instr = (sr.instr ?? 0) >>> 0;
    const decoded = sr.decoded;
    const ctrl = sr.ctrl;
    const alu_res = sr.alu_res;
    const rs1_val = sr.rs1_val;
    const rs2_val = sr.rs2_val;
    const mem_data = sr.mem_data;
    const pc_before = sr.pc_before;

    // Salida del MUX de write-back (dato que “viaja” por el bus a RegFile), aun si RegWrite=0
    const wb_bus = (decoded?.opcode === 0x03 && ctrl?.alu2reg)
        ? (mem_data ?? null)
        : (alu_res ?? null);

    // Selector del mux-imm: 1 cuando la instrucción es STORE (instr[11:7] son imm[4:0])
    // y 0 cuando se usa como RD (I/R/Load/etc). En este simulador, STORE => ctrl.wem.
    const imm_rd_sel = ctrl?.wem ? 1 : 0;
    
    // Mapeo de buses a valores
    const busMap = {
        // Buses PC
        'bus-pc-im': { label: 'PC → Instruction Memory', value: pc_before, src: 'pc_before' },
        'bus-pc-inc': { label: 'PC → PC+4', value: pc_before, src: 'pc_before' },
        'path57': { label: 'PC Loop', value: pc_before, src: 'pc_before' },
        'path58': { label: 'PC Increment', value: (pc_before + 4) >>> 0, src: 'pc_before + 4' },
        'path59': { label: 'PC+4 Result', value: (pc_before + 4) >>> 0, src: 'pc_before + 4' },

        // Instrucción completa (32 bits)
        'path49': { label: 'Instruction (32-bit)', value: instr, src: 'instr[31:0]' },
        
        // Inmediatos
        // Nota: en el datapath, estos wires vienen directo de la instrucción.
        // imm[11:5] = instr[31:25] (7 bits)
        'imm(11:15)': { label: 'Immediate [11:5] (instr[31:25])', value: (instr >>> 25) & 0x7f, src: 'instr[31:25]' },
        // imm[4:0] = instr[11:7] (5 bits) (útil para S-type)
        'imm(4:0)': { label: 'Immediate [4:0] (instr[11:7])', value: (instr >>> 7) & 0x1f, src: 'instr[11:7]' },
        // Este es el inmediato ya extendido (salida del sign-extend / imm generator)
        'imm-rd': { label: 'MUX-IMM Select (imm[4:0] vs rd)', value: imm_rd_sel, src: 'ctrl.wem (STORE?)' },
        
        // Señales hacia/desde banco de registros
        // Nota: algunos IDs del SVG no están nombrados como rs1/rs2/rd; aquí se mapean según el uso.
        // Según tu lista:
        // - path50 = instr[11:7]
        // - path51 = instr[24:20]
        // - path89 = instr[19:15]
        // - path90 = instr[24:20]
        // - path92 = instr[11:7]
        'path50': { label: 'RD field (instr[11:7])', value: (instr >>> 7) & 0x1f, src: 'instr[11:7]' },
        'path51': { label: 'RS2 field (instr[24:20])', value: (instr >>> 20) & 0x1f, src: 'instr[24:20]' },
        'path89': { label: 'RS1 field (instr[19:15])', value: (instr >>> 15) & 0x1f, src: 'instr[19:15]' },
        'path90': { label: 'RS2 field (instr[24:20])', value: (instr >>> 20) & 0x1f, src: 'instr[24:20]' },
        'path92': { label: 'RD field (instr[11:7])', value: (instr >>> 7) & 0x1f, src: 'instr[11:7]' },
        
        // ALU
        'path81': { label: 'ALU Input A', value: rs1_val, src: 'rs1_val' },
        'path3': { label: 'ALU Input B', value: sr.alu_b, src: 'alu_b' },
        'path78': { label: 'ALU Result', value: alu_res, src: 'alu_res' },
        'alu-reg(0)': { label: 'ALU → Registers', value: alu_res, src: 'alu_res' },
        
        // Memoria de datos
        'path82': { label: 'Memory Address', value: alu_res, src: 'alu_res' },
        'path84': { label: 'Write Data → Memory', value: rs2_val, src: 'rs2_val' },
        'path80': { label: 'Read Data from Memory', value: mem_data, src: 'mem_data' },
        'path86': { label: 'Memory → MUX', value: mem_data, src: 'mem_data' },
        
        // Write-back
        'path91': { label: 'WB Bus → Register File', value: (wb_bus ?? sr.wb_val), src: 'wb_bus (alu2reg ? mem_data : alu_res)' },

        // Señales de control (paths con id directo)
        'alu-op': { label: 'ALUOp (4-bit)', value: (ctrl?.alu_op ?? 0) & 0xf, src: 'ctrl.alu_op & 0xF' },
        'alu-src': { label: 'ALUSrc (sel)', value: (ctrl?.alu_src ?? 0) ? 1 : 0, src: 'ctrl.alu_src' },
        'alu2reg': { label: 'ALU2Reg (sel)', value: (ctrl?.alu2reg ?? 0) ? 1 : 0, src: 'ctrl.alu2reg' },
        'wem': { label: 'MemWrite (WEM)', value: (ctrl?.wem ?? 0) ? 1 : 0, src: 'ctrl.wem' },
        'wer': { label: 'RegWrite (WER)', value: sr.wb_we ? 1 : 0, src: 'wb_we' },
        'branch': { label: 'Branch (sel)', value: (ctrl?.branch ?? 0) ? 1 : 0, src: 'ctrl.branch' },
        'br-neg': { label: 'BranchNE (sel)', value: (ctrl?.branch_ne ?? 0) ? 1 : 0, src: 'ctrl.branch_ne' }
    };

    // Fallback: mostrar al menos el ID del bus aunque no haya mapeo
    return busMap[busId] || { label: busId, value: null };
}

function showBusTooltip(event, bus) {
    const tooltip = document.getElementById('bus-tooltip');
    if (!tooltip) return;
    
    const busValue = getBusValue(bus.id);
    
    let valueStr;
    if (busValue.value === undefined || busValue.value === null) {
        valueStr = '--';
    } else {
        const val = busValue.value >>> 0; // Convertir a unsigned
        valueStr = `0x${val.toString(16).toUpperCase().padStart(8, '0')} (${toInt32(val)})`;
    }
    
    const srcHtml = busValue.src ? `<div style="color: #64748b; margin-top: 4px; font-size: 12px;">src: <code>${busValue.src}</code></div>` : '';
    const hintHtml = busValue.hint ? `<div style="color: #94a3b8; margin-top: 4px; font-size: 12px;">${busValue.hint}</div>` : '';
    tooltip.innerHTML = `
        <div style="font-weight: bold; color: #3b82f6; margin-bottom: 4px;">${busValue.label}</div>
        <div style="color: #22c55e;">${valueStr}</div>
        ${srcHtml}
        ${hintHtml}
    `;
    tooltip.style.display = 'block';
    moveBusTooltip(event);
}

function moveBusTooltip(event) {
    const tooltip = document.getElementById('bus-tooltip');
    if (!tooltip || tooltip.style.display === 'none') return;

    const x = (event.pageX ?? (event.clientX + window.scrollX));
    const y = (event.pageY ?? (event.clientY + window.scrollY));
    tooltip.style.left = (x + 15) + 'px';
    tooltip.style.top = (y + 15) + 'px';
}

function hideBusTooltip() {
    const tooltip = document.getElementById('bus-tooltip');
    if (tooltip) tooltip.style.display = 'none';
}

/* ============================================================
   MEMORY VIEW TOGGLE
============================================================ */
function setupMemoryViewToggle() {
    const viewBtns = document.querySelectorAll('.view-btn');
    const gridView = document.getElementById('memory-grid-view');
    const tableView = document.getElementById('memory-table-view');
    
    viewBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            viewBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const view = btn.dataset.view;
            
            if (view === 'grid') {
                gridView.classList.add('active');
                tableView.classList.remove('active');
                currentMemoryView = 'grid';
            } else {
                gridView.classList.remove('active');
                tableView.classList.add('active');
                currentMemoryView = 'table';
            }
        });
    });
}

/* ============================================================
   SPEED CONTROL
============================================================ */
function setupSpeedControl() {
    const slider = document.getElementById('speed-slider');
    const valueDisplay = document.getElementById('speed-value');
    
    if (!slider) return;
    
    slider.addEventListener('input', (e) => {
        executionDelay = parseInt(e.target.value);
        valueDisplay.textContent = executionDelay + 'ms';
    });
}

function setupFormatSelector() {
    const toggleGroup = document.getElementById('format-toggle');
    
    if (!toggleGroup) {
        console.error('No se encontró el elemento format-toggle');
        return;
    }
    
    // Agregar listener DIRECTAMENTE al contenedor con event delegation
    toggleGroup.addEventListener('click', function(e) {
        // Verificar si es un botón
        if (!e.target.classList.contains('format-toggle-btn')) {
            return;
        }
        
        const btn = e.target;
        const format = btn.dataset.format;
        
        // Prevenir comportamiento por defecto
        e.preventDefault();
        e.stopPropagation();
        
        // Actualizar estado visual
        const allBtns = toggleGroup.querySelectorAll('.format-toggle-btn');
        allBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Actualizar formato global
        displayFormat = format;
        
        // Re-renderizar valores
        if (currentDecoded) {
            updateFormatTableValues(currentDecoded);
        }
    }, true); // Capture phase para asegurar que se dispare
}

/* ============================================================
   TOGGLE SIDEBAR
============================================================ */
function toggleSidebar() {
    const mainLayout = document.querySelector('.main-layout');
    mainLayout.classList.toggle('sidebar-collapsed');
    
    // Rotar el icono del botón collapse
    const collapseBtn = document.getElementById('btn-collapse-sidebar');
    if (mainLayout.classList.contains('sidebar-collapsed')) {
        collapseBtn.querySelector('svg').style.transform = 'rotate(180deg)';
    } else {
        collapseBtn.querySelector('svg').style.transform = 'rotate(0deg)';
    }
}

/* ============================================================
   STEP
============================================================ */
let isStepInProgress = false;

// Controla el ritmo visual de las animaciones por etapa.
// "Step" debe ser MUY lento para observar el flujo.
let visualStageDelayMs = 400;

function escapeSvgId(id) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(id);
    return String(id).replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}

async function handleStep() {
    if (isStepInProgress) return;
    isStepInProgress = true;

    visualStageDelayMs = 1800;
    const result = await cpu.stepWithStageDelay(updateStageIndicator, visualStageDelayMs);
    if (result) {
        // Almacenar resultado para tooltips
        lastStepResult = result;
        
        // Detectar si la instrucción accede a memoria
        if (result.decoded.opcode === 0x03 || result.decoded.opcode === 0x23) {
            const addrIndex = (result.alu_res >>> 2) & 0x1f;
            const operation = result.decoded.opcode === 0x03 ? 'READ' : 'WRITE';
            updateMemoryStats(addrIndex * 4, operation);
        }
        updateUI(result);
    }
    
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

    async function runLoop() {
        while (isRunning && !cpu.state.halted) {
            const stageDelay = Math.min(executionDelay / 5, 300);
            visualStageDelayMs = stageDelay;
            const result = await cpu.stepWithStageDelay(updateStageIndicator, stageDelay);
            if (result) {
                lastStepResult = result;

                updateUI(result);
            }
            await new Promise(resolve => setTimeout(resolve, executionDelay / 5));
        }

        if (cpu.state.halted || !isRunning) {
            isRunning = false;
            btn.classList.remove("active");
            span.textContent = "Run";
        }
    }
    
    runLoop();
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
    lastStepResult = null;
    memoryAccessCount = 0;
    lastMemoryAddr = null;
    lastMemoryOp = '--';
    
    cpu.reset();
    updateUI();
    
    // Resetear estadísticas de memoria
    document.getElementById('memory-access-count').textContent = '0';
    document.getElementById('memory-last-addr').textContent = '--';
    document.getElementById('memory-last-op').textContent = '--';

    document.querySelectorAll('.stage-pill').forEach(el => el.classList.remove('active'));
}

/* ============================================================
   LOAD PRESET PROGRAMS
============================================================ */
const PRESET_PROGRAMS = {
    collatz: `addi x5, x0, 100
addi x7, x0, 0
addi x6, x0, 256      
loop:
    sw x5, 0(x6)        
    addi x6, x6, 4      
    addi x7, x7, 1     
    addi x28, x0, 1
    beq x5, x28, fin    
    addi x29, x0, 1
    and  x30, x5, x29
    beq  x30, x0, par   
    slli x31, x5, 1
    add  x31, x31, x5
    addi x5, x31, 1
    beq x0, x0, loop
par:
    srli x5, x5, 1
    beq x0, x0, loop
fin:
    sw x7, 0(x6)    
    addi x0, x0, 0`,

    fibonacci: `main:
    addi x10, x0, 1
    addi x11, x0, 1
    addi x7, x0, 0
    addi x5, x0, 500
    addi x6, x0, 252
    addi x6, x6, 4
    sw   x10, 0(x6)      
    sw   x11, 0(x6)     
loop:
    add  x12, x10, x11
    bge  x12, x5, fin
    sw   x12, 0(x6)
    addi x6, x6, 4
    addi x7, x7, 1
    add  x10, x11, x0
    add  x11, x12, x0
    beq  x0, x0, loop
fin:
    sw   x7, 0(x6)     
    addi x0, x0, 0`
};

function loadPresetProgram(preset) {
    const programInput = document.getElementById('program-input');
    if (!programInput) return;
    
    const program = PRESET_PROGRAMS[preset];
    if (!program) {
        showToast(`Programa "${preset}" no encontrado`, "error");
        return;
    }
    
    programInput.value = program;
    showToast(`Programa ${preset.charAt(0).toUpperCase() + preset.slice(1)} cargado`, "success");
}

/* ============================================================
   LOAD PROGRAM
============================================================ */
function handleLoad() {
    const code = document.getElementById('program-input').value.trim();
    if (!code) return;

    let program;

    try {
        // Si ya viene en hexadecimal
        if (/^[0-9a-fA-F]+$/.test(code.split("\n")[0].trim())) {
            program = code;
        } else {
            // AQUÍ puede lanzar errores el ensamblador
            const hexArray = assembleProgram(code);
            program = hexArray
                .map(x => x.toString(16).padStart(8, "0"))
                .join("\n");
        }

        lastDecoded = null;
        cpu.loadProgram(program);
        updateUI();

        showToast("Programa cargado exitosamente", "success");

    } catch (err) {
        // 👇 AQUÍ atrapamos el error del ensamblador
        console.error(err);
        showToast(err.message, "error");
    }
}

const toastSVG = {
    success: `
        <svg width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
    `,
    error: `
        <svg width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
    `,
    info: `
        <svg width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
    `
};


/* ============================================================
   TOAST NOTIFICATIONS
============================================================ */
function showToast(message, type = "info") {
    // Remover toast anterior si existe
    const existingToast = document.querySelector('.toast');
    if (existingToast) existingToast.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
       toast.innerHTML = `
        ${toastSVG[type] || toastSVG.info}
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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
function updateStageIndicator(stage, stageData = null) {
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

    // Animación de “datos viajando” (sutil) en buses clave por etapa
    animateStageDataFlow(stage, stageData);
}

function animateStageDataFlow(stage, stageData = null) {
    const svg = dpAnim.svg;
    if (!svg) return;

    // Buses clave por etapa (IDs existentes en el SVG)
    const stageBuses = {
        [Stage.FETCH]: ['bus-pc-im', 'path49', 'path58', 'path59'],
        // Decode: índices rs1/rd + inmediato + señales de control
        [Stage.DECODE]: [
            'path50',
            'path51',
            'path89',
            'path90',
            'path92',
            'imm(11:15)',
            'imm(4:0)',
            'imm-rd',
            'branch',
            'br-neg',
            'alu-src',
            'alu-op',
            'alu2reg',
            'wem'
        ],
        // Exec: datos saliendo del banco de registros y entrando a la ALU
        [Stage.EXEC]: ['path81', 'path3', 'path78'],
        [Stage.MEM]: ['path82', 'path84', 'path80'],
        [Stage.WB]: ['alu-reg(0)', 'path91']
    };

    const ids = stageBuses[stage] || [];
    ids.forEach((id, i) => {
        const el = svg.querySelector('#' + escapeSvgId(id));
        if (!el) return;

        // Algunos paths en el SVG están dibujados “al revés”. Invertimos SOLO los que lo necesitan.
        const reverseSignals = new Set(['br-neg', 'branch', 'imm-rd', 'alu-src', 'alu2reg', 'wem', 'alu-op']);
        const reverse = reverseSignals.has(id);

        const durationMs = Math.max(350, Math.round(visualStageDelayMs * 0.8));
        const staggerMs = Math.max(35, Math.round(visualStageDelayMs * 0.12));
        const delayMs = i * staggerMs;

        // Paquete visual recorriendo el cable durante la etapa
        setTimeout(() => {
            spawnPacketOnPath(el, { durationMs, radius: 3.0, soft: i > 1, reverse });

            // Etiqueta numérica (decimal) viajando por el mismo cable
            const v = getBusValue(id, stageData)?.value;
            if (v === null || v === undefined) return;

            spawnValueTagOnPath(el, v, { durationMs, yOffset: -10, reverse });
        }, delayMs);
    });

    // Pings sutiles en eventos típicos
    if (stage === Stage.WB) {
        datapathPing('#mux-wb');
    }
    if (stage === Stage.MEM) {
        datapathPing('#data-mem');
    }
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
            // Componentes principales
            '#pc',
            '#instr-mem',
            '#pc-adder',
            // Buses de datos
            '#path49',
            '#path57', '#path58', '#path59',
            'path[id^="bus-pc"]'
        ],
        [Stage.DECODE]: [
            // Componentes principales
            '#instr-mem',
            '#control-unit',
            '#registers',
            '#sign-extend',
            '#mux-imm',
            // Buses de datos
            'path[id^="path50"]',
            'path[id^="path51"]',
            'path[id^="path89"]',
            'path[id^="path90"]',
            'path[id^="path92"]',
            'path[id^="imm"]',
            // Líneas de control activas desde control unit
            '#alu-op',      // Control de operación ALU
            '#alu-src',     // Control de fuente para ALU (reg vs imm)
            '#wem',         // Write enable memoria
            '#wer',         // Write enable registros
            '#alu2reg',     // Control mux write-back
            '#branch',      // Señal de branch
            '#br-neg',      // Señal de branch negado
            '#imm-rd'       // Línea de inmediato hacia rd
        ],
        [Stage.EXEC]: [
            // Componentes principales
            '#alu',
            '#mux-alu-a',
            '#registers',
            '#sign-extend',
            // Buses de datos
            'path[id^="path3"]',
            'path[id^="path81"]',
            // Líneas de control activas
            '#alu-op',      // Operación de la ALU
            '#alu-src',     // Selección de fuente para ALU
            '#branch',      // Branch activo en etapa de ejecución
            '#br-neg'       // Branch negado
        ],
        [Stage.MEM]: [
            // Componentes principales
            '#data-mem',
            '#alu',
            // Buses de datos
            'path[id^="path78"]',
            'path[id^="path82"]',
            'path[id^="path84"]',
            'path[id^="path80"]',
            'path[id^="path86"]',   // do2 - dato de memoria
            // Líneas de control activas
            '#wem',         // Write enable para memoria de datos
            '#branch',      // Branch (decisión basada en resultado ALU)
            '#br-neg'       // Branch negado
        ],
        [Stage.WB]: [
            // Componentes principales
            '#mux-wb',
            '#data-mem',
            '#registers',
            // Buses de datos
            'path[id^="alu-reg"]',
            'path[id^="path91"]',   // di - dato hacia registros
            // Líneas de control activas
            '#alu2reg',     // Selección de fuente para write-back (ALU vs MEM)
            '#wer'          // Write enable para banco de registros
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

    const opcode = decoded.opcode;

    // Determinar tipo de instrucción
    const isR = opcode === 0x33;
    const isI = opcode === 0x13 || opcode === 0x03 || opcode === 0x67;
    const isS = opcode === 0x23;
    const isB = opcode === 0x63;
    const isU = opcode === 0x37 || opcode === 0x17;
    const isJ = opcode === 0x6f;

    // Actualizar badge de tipo
    const typeBadge = document.getElementById('instruction-type');
    typeBadge.className = 'instruction-type-badge';
    
    if (isR) { typeBadge.textContent = 'R-Type'; typeBadge.classList.add('r-type'); }
    else if (isI) { typeBadge.textContent = 'I-Type'; typeBadge.classList.add('i-type'); }
    else if (isS) { typeBadge.textContent = 'S-Type'; typeBadge.classList.add('s-type'); }
    else if (isB) { typeBadge.textContent = 'B-Type'; typeBadge.classList.add('b-type'); }
    else if (isU) { typeBadge.textContent = 'U-Type'; typeBadge.classList.add('u-type'); }
    else if (isJ) { typeBadge.textContent = 'J-Type'; typeBadge.classList.add('j-type'); }
    else { typeBadge.textContent = '--'; }

    // Si NO cambia la instrucción → NO animar
    if (lastDecoded && JSON.stringify(lastDecoded) === JSON.stringify(decoded))
        return;

    lastDecoded = decoded;

    // Ejecutar animación de fusión de campos
    animateInstructionFormat(decoded, { isR, isI, isS, isB, isU, isJ });
}

/* ============================================================
   ANIMACIÓN DE FUSIÓN DE CAMPOS PARA INMEDIATOS
============================================================ */
function animateInstructionFormat(decoded, types) {
    const { isR, isI, isS, isB, isU, isJ } = types;
    
    // Restaurar tabla al estado original primero
    resetFormatTable();
    
    // Delay para ver el estado inicial
    setTimeout(() => {
        // Iluminar campos activos
        document.getElementById('field-opcode').classList.add('active');
        
        if (isR) {
            // R-Type: todos los campos normales
            ['field-funct7', 'field-rs2', 'field-rs1', 'field-funct3', 'field-rd'].forEach((id, i) => {
                setTimeout(() => {
                    document.getElementById(id)?.classList.add('active');
                }, i * 100);
            });
        }
        
        else if (isI) {
            // I-Type: funct7 + rs2 se fusionan en imm[11:0]
            ['field-rs1', 'field-funct3', 'field-rd'].forEach((id, i) => {
                setTimeout(() => {
                    document.getElementById(id)?.classList.add('active');
                }, i * 100);
            });
            
            // Animación de fusión para imm[11:0]
            setTimeout(() => {
                mergeFieldsForImmediate(['field-funct7', 'field-rs2'], 'imm[11:0]', decoded.imm, 2);
            }, 400);
        }
        
        else if (isS) {
            // S-Type: funct7 = imm[11:5], rd = imm[4:0]
            ['field-rs1', 'field-rs2', 'field-funct3'].forEach((id, i) => {
                setTimeout(() => {
                    document.getElementById(id)?.classList.add('active');
                }, i * 100);
            });
            
            // Animación de fusión para los inmediatos
            setTimeout(() => {
                transformFieldToImm('field-funct7', 'imm[11:5]', (decoded.imm >> 5) & 0x7F);
                transformFieldToImm('field-rd', 'imm[4:0]', decoded.imm & 0x1F);
            }, 400);
        }
        
        else if (isB) {
            // B-Type: similar a S-Type
            ['field-rs1', 'field-rs2', 'field-funct3'].forEach((id, i) => {
                setTimeout(() => {
                    document.getElementById(id)?.classList.add('active');
                }, i * 100);
            });
            
            setTimeout(() => {
                transformFieldToImm('field-funct7', 'imm[12|10:5]', '');
                transformFieldToImm('field-rd', 'imm[4:1|11]', '');
            }, 400);
        }
        
        else if (isU || isJ) {
            // U-Type y J-Type: funct7, rs2, rs1, funct3 se fusionan en imm[31:12] o imm[20|...]
            document.getElementById('field-rd')?.classList.add('active');
            
            setTimeout(() => {
                const immLabel = isU ? 'imm[31:12]' : 'imm[20|10:1|11|19:12]';
                mergeFieldsForImmediate(['field-funct7', 'field-rs2', 'field-rs1', 'field-funct3'], immLabel, decoded.imm, 4);
            }, 400);
        }
        
    }, 200);
}

/* ============================================================
   FUSIONAR MÚLTIPLES CAMPOS EN UNO (PARA I-TYPE, U-TYPE, J-TYPE)
============================================================ */
function mergeFieldsForImmediate(fieldIds, immLabel, immValue, colspan) {
    const firstField = document.getElementById(fieldIds[0]);
    if (!firstField) return;
    
    // Añadir clase de preparación para fusión
    fieldIds.forEach((id, index) => {
        const field = document.getElementById(id);
        if (field) {
            field.classList.add('merging');
            if (index > 0) {
                // Los campos que se "comen" se desvanecen
                setTimeout(() => {
                    field.classList.add('merged-away');
                }, 200);
            }
        }
    });
    
    // Después de un delay, transformar el primer campo
    setTimeout(() => {
        firstField.classList.remove('merging');
        firstField.classList.add('merged-imm');
        firstField.setAttribute('colspan', colspan);
        
        // Cambiar contenido
        const nameSpan = firstField.querySelector('.field-name');
        const codeEl = firstField.querySelector('code');
        
        if (nameSpan) nameSpan.textContent = immLabel;
        if (codeEl) codeEl.textContent = immValue !== undefined ? immValue : '--';
        
        // Ocultar los otros campos
        fieldIds.slice(1).forEach(id => {
            const field = document.getElementById(id);
            if (field) {
                field.style.display = 'none';
            }
        });
        
    }, 500);
}

/* ============================================================
   TRANSFORMAR UN CAMPO INDIVIDUAL A INMEDIATO (PARA S-TYPE, B-TYPE)
============================================================ */
function transformFieldToImm(fieldId, immLabel, immValue) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    
    field.classList.add('transforming-to-imm');
    
    setTimeout(() => {
        const nameSpan = field.querySelector('.field-name');
        const codeEl = field.querySelector('code');
        
        if (nameSpan) nameSpan.textContent = immLabel;
        if (codeEl && immValue !== '') codeEl.textContent = '0x' + immValue.toString(16);
        
        field.classList.remove('transforming-to-imm');
        field.classList.add('transformed-imm');
    }, 300);
}

/* ============================================================
   RESTAURAR TABLA AL FORMATO ORIGINAL
============================================================ */
function resetFormatTable() {
    const fields = [
        { id: 'field-funct7', name: 'funct7', valId: 'val-funct7' },
        { id: 'field-rs2', name: 'rs2', valId: 'val-rs2' },
        { id: 'field-rs1', name: 'rs1', valId: 'val-rs1' },
        { id: 'field-funct3', name: 'funct3', valId: 'val-funct3' },
        { id: 'field-rd', name: 'rd', valId: 'val-rd' },
        { id: 'field-opcode', name: 'opcode', valId: 'val-opcode' }
    ];
    
    fields.forEach(f => {
        const field = document.getElementById(f.id);
        if (field) {
            // Remover todas las clases de animación
            field.classList.remove('active', 'merging', 'merged-away', 'merged-imm', 
                                   'transforming-to-imm', 'transformed-imm', 'imm-field', 'imm-highlight');
            
            // Restaurar colspan
            field.removeAttribute('colspan');
            
            // Mostrar campo
            field.style.display = '';
            
            // Restaurar nombre original
            const nameSpan = field.querySelector('.field-name');
            if (nameSpan) nameSpan.textContent = f.name;
        }
    });
}


function getBinaryRepresentation(decoded) {
    if (!decoded) return '--------------------------------';
    
    const opcode = decoded.opcode;
    const rd = decoded.rd ?? 0;
    const rs1 = decoded.rs1 ?? 0;
    const rs2 = decoded.rs2 ?? 0;
    const funct3 = decoded.funct3 ?? 0;
    const funct7 = decoded.funct7 ?? 0;
    
    // Construir instrucción binaria según tipo
    const opcodeBin = opcode.toString(2).padStart(7, '0');
    const rdBin = rd.toString(2).padStart(5, '0');
    const rs1Bin = rs1.toString(2).padStart(5, '0');
    const rs2Bin = rs2.toString(2).padStart(5, '0');
    const funct3Bin = funct3.toString(2).padStart(3, '0');
    const funct7Bin = funct7.toString(2).padStart(7, '0');
    
    return `${funct7Bin} ${rs2Bin} ${rs1Bin} ${funct3Bin} ${rdBin} ${opcodeBin}`;
}

function disassembleRV32I(instr, pc = 0) {
    if (instr == null) return '--';
    const word = instr >>> 0;

    // Detectar fin del programa (coincidir con la lógica de HALT del CPU)
    if (word === 0) return 'halt';
    if (word === 0x00000073) return 'ecall';
    if (word === 0x00100073) return 'ebreak';

    const opcode = word & 0x7f;
    const rd = (word >>> 7) & 0x1f;
    const funct3 = (word >>> 12) & 0x7;
    const rs1 = (word >>> 15) & 0x1f;
    const rs2 = (word >>> 20) & 0x1f;
    const funct7 = (word >>> 25) & 0x7f;

    const x = (n) => `x${n}`;
    const hex = () => toHex32(word);

    // Helpers de inmediatos
    const immI = () => signExtend(word >>> 20, 12) | 0;
    const immS = () => {
        const imm4_0 = (word >>> 7) & 0x1f;
        const imm11_5 = (word >>> 25) & 0x7f;
        return (signExtend((imm11_5 << 5) | imm4_0, 12) | 0);
    };
    const immB = () => {
        const imm12 = (word >>> 31) & 0x1;
        const imm10_5 = (word >>> 25) & 0x3f;
        const imm4_1 = (word >>> 8) & 0x0f;
        const imm11 = (word >>> 7) & 0x1;
        const raw = (imm12 << 12) | (imm11 << 11) | (imm10_5 << 5) | (imm4_1 << 1);
        return (signExtend(raw, 13) | 0);
    };
    const immU = () => (word & 0xfffff000) >>> 0;
    const immJ = () => {
        const imm20 = (word >>> 31) & 0x1;
        const imm10_1 = (word >>> 21) & 0x3ff;
        const imm11 = (word >>> 20) & 0x1;
        const imm19_12 = (word >>> 12) & 0xff;
        const raw = (imm20 << 20) | (imm19_12 << 12) | (imm11 << 11) | (imm10_1 << 1);
        return (signExtend(raw, 21) | 0);
    };

    // ------------ R-TYPE ------------
    if (opcode === 0x33) {
        let mn = null;
        if (funct3 === 0x0 && funct7 === 0x00) mn = 'add';
        else if (funct3 === 0x0 && funct7 === 0x20) mn = 'sub';
        else if (funct3 === 0x7 && funct7 === 0x00) mn = 'and';
        else if (funct3 === 0x6 && funct7 === 0x00) mn = 'or';
        else if (funct3 === 0x4 && funct7 === 0x00) mn = 'xor';
        else if (funct3 === 0x1 && funct7 === 0x00) mn = 'sll';
        else if (funct3 === 0x5 && funct7 === 0x00) mn = 'srl';
        else if (funct3 === 0x5 && funct7 === 0x20) mn = 'sra';
        if (!mn) return hex();
        return `${mn} ${x(rd)}, ${x(rs1)}, ${x(rs2)}`;
    }

    // ------------ I-TYPE ARITH ------------
    if (opcode === 0x13) {
        const imm = immI();
        let mn = null;
        if (funct3 === 0x0) mn = 'addi';
        else if (funct3 === 0x7) mn = 'andi';
        else if (funct3 === 0x6) mn = 'ori';
        else if (funct3 === 0x4) mn = 'xori';
        else if (funct3 === 0x2) mn = 'slti';
        else if (funct3 === 0x1) {
            const shamt = (word >>> 20) & 0x1f;
            mn = 'slli';
            return `${mn} ${x(rd)}, ${x(rs1)}, ${shamt}`;
        } else if (funct3 === 0x5) {
            const shamt = (word >>> 20) & 0x1f;
            mn = (funct7 === 0x20) ? 'srai' : 'srli';
            return `${mn} ${x(rd)}, ${x(rs1)}, ${shamt}`;
        }
        if (!mn) return hex();
        return `${mn} ${x(rd)}, ${x(rs1)}, ${imm}`;
    }

    // ------------ LOAD ------------
    if (opcode === 0x03) {
        const imm = immI();
        if (funct3 === 0x2) return `lw ${x(rd)}, ${imm}(${x(rs1)})`;
        return hex();
    }

    // ------------ STORE ------------
    if (opcode === 0x23) {
        const imm = immS();
        if (funct3 === 0x2) return `sw ${x(rs2)}, ${imm}(${x(rs1)})`;
        return hex();
    }

    // ------------ BRANCH ------------
    if (opcode === 0x63) {
        const imm = immB();
        let mn = null;
        if (funct3 === 0x0) mn = 'beq';
        else if (funct3 === 0x1) mn = 'bne';
        else if (funct3 === 0x4) mn = 'blt';
        else if (funct3 === 0x5) mn = 'bge';
        else if (funct3 === 0x6) mn = 'bltu';
        else if (funct3 === 0x7) mn = 'bgeu';
        if (!mn) return hex();
        // Mostrar offset (inmediato) y destino en hex (útil para debug)
        const target = ((pc >>> 0) + (imm | 0)) >>> 0;
        return `${mn} ${x(rs1)}, ${x(rs2)}, ${imm} (${toHex32(target)})`;
    }

    // ------------ LUI ------------
    if (opcode === 0x37) {
        const imm = immU();
        return `lui ${x(rd)}, ${toHex32(imm)}`;
    }

    // ------------ JAL ------------
    if (opcode === 0x6f) {
        const imm = immJ();
        const target = ((pc >>> 0) + (imm | 0)) >>> 0;
        return `jal ${x(rd)}, ${imm} (${toHex32(target)})`;
    }

    // ------------ SYSTEM ------------
    if (opcode === 0x73) {
        return hex();
    }

    return hex();
}

/* ============================================================
   UI UPDATES
============================================================ */
function updateUI(stepResult) {
    document.getElementById('ui-pc').textContent = toHex32(cpu.state.pc);
    document.getElementById('ui-cycle').textContent = cpu.state.cycle;

    // Header: siempre intentar mostrar la instrucción actual
    const asmEl = document.getElementById('ui-asm');
    if (asmEl) {
        const instrFromStep = (typeof stepResult?.instr === 'number') ? (stepResult.instr >>> 0) : null;
        let instr = instrFromStep;
        if (instr == null) {
            const wi = (cpu.state.pc >>> 2);
            instr = (wi >= 0 && wi < cpu.state.instrMem.length) ? (cpu.state.instrMem[wi] >>> 0) : null;
        }

        const pcForDisasm = (typeof stepResult?.pc_before === 'number') ? (stepResult.pc_before >>> 0) : (cpu.state.pc >>> 0);

        if (typeof stepResult?.asm === 'string' && stepResult.asm.trim()) {
            asmEl.textContent = stepResult.asm;
        } else if (instr == null) {
            asmEl.textContent = '--';
        } else {
            asmEl.textContent = disassembleRV32I(instr, pcForDisasm);
        }
    }

    renderRegisters();
    renderMemory();

    if (stepResult?.decoded) {
        const d = stepResult.decoded;
        currentDecoded = d; // Guardar para actualizar cuando cambie el formato

        // Actualizar tabla de formato de instrucción con formato seleccionado
        updateFormatTableValues(d);
        
        // Detalles adicionales - binario siempre igual
        document.getElementById('info-binary').textContent = getBinaryRepresentation(d);
        
        highlightDecodeOnlyOnChange(d);
    }

    // Si el visor está abierto, actualizarlo con el estado actual
    refreshModuleVisor();
}

/* ============================================================
   ACTUALIZAR VALORES DE LA TABLA CON FORMATO SELECCIONADO
============================================================ */
function updateFormatTableValues(d) {
    if (!d) return;
    
    // Aplicar formato a TODOS los campos según selección del usuario
    // Solo actualizamos el contenido de los elementos <code>, NO tocamos la estructura
    
    switch (displayFormat) {
        case 'hex':
            // Opcode en hex
            const opcodeHex = '0x' + d.opcode.toString(16).toUpperCase().padStart(2, '0');
            updateCodeElement('val-opcode', opcodeHex);
            
            // Registros en hex
            const rdHex = d.rd !== undefined ? '0x' + d.rd.toString(16).toUpperCase() : '--';
            const rs1Hex = d.rs1 !== undefined ? '0x' + d.rs1.toString(16).toUpperCase() : '--';
            const rs2Hex = d.rs2 !== undefined ? '0x' + d.rs2.toString(16).toUpperCase() : '--';
            updateCodeElement('val-rd', rdHex);
            updateCodeElement('val-rs1', rs1Hex);
            updateCodeElement('val-rs2', rs2Hex);
            
            // Funct en hex
            const funct3Hex = '0x' + d.funct3.toString(16).toUpperCase();
            const funct7Hex = '0x' + d.funct7.toString(16).toUpperCase().padStart(2, '0');
            updateCodeElement('val-funct3', funct3Hex);
            updateCodeElement('val-funct7', funct7Hex);
            
            // Inmediato en hex
            const immHex = d.imm !== undefined ? '0x' + (d.imm >>> 0).toString(16).toUpperCase().padStart(8, '0') : '--';
            updateCodeElement('info-imm', immHex);
            break;
            
        case 'bin':
            // Opcode en binario
            const opcodeBin = d.opcode.toString(2).padStart(7, '0');
            updateCodeElement('val-opcode', opcodeBin);
            
            // Registros en binario
            const rdBin = d.rd !== undefined ? d.rd.toString(2).padStart(5, '0') : '--';
            const rs1Bin = d.rs1 !== undefined ? d.rs1.toString(2).padStart(5, '0') : '--';
            const rs2Bin = d.rs2 !== undefined ? d.rs2.toString(2).padStart(5, '0') : '--';
            updateCodeElement('val-rd', rdBin);
            updateCodeElement('val-rs1', rs1Bin);
            updateCodeElement('val-rs2', rs2Bin);
            
            // Funct en binario
            const funct3Bin = d.funct3.toString(2).padStart(3, '0');
            const funct7Bin = d.funct7.toString(2).padStart(7, '0');
            updateCodeElement('val-funct3', funct3Bin);
            updateCodeElement('val-funct7', funct7Bin);
            
            // Inmediato en binario
            const immBin = d.imm !== undefined ? (d.imm >>> 0).toString(2).padStart(32, '0') : '--';
            updateCodeElement('info-imm', immBin);
            break;
            
        case 'dec':
        default:
            // Opcode en decimal
            updateCodeElement('val-opcode', d.opcode.toString());
            
            // Registros en decimal
            const rdDec = d.rd !== undefined ? d.rd.toString() : '--';
            const rs1Dec = d.rs1 !== undefined ? d.rs1.toString() : '--';
            const rs2Dec = d.rs2 !== undefined ? d.rs2.toString() : '--';
            updateCodeElement('val-rd', rdDec);
            updateCodeElement('val-rs1', rs1Dec);
            updateCodeElement('val-rs2', rs2Dec);
            
            // Funct en decimal
            updateCodeElement('val-funct3', d.funct3.toString());
            updateCodeElement('val-funct7', d.funct7.toString());
            
            // Inmediato en decimal - convertir a int32 con signo
            const immDec = d.imm !== undefined ? toInt32(d.imm).toString() : '--';
            updateCodeElement('info-imm', immDec);
            break;
    }
}


function updateCodeElement(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = value;
    }
}


function renderRegisters() {
    const tbody = document.querySelector('#registers-table tbody');
    tbody.innerHTML = "";

    for (let i = 0; i < 32; i++) {
        const regVal = cpu.state.regs[i] >>> 0;
        const hexVal = toHex32(regVal);
        const abiName = ABI_NAMES[i];

        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td class="col-reg">x${i}</td>
            <td class="col-alias">${abiName}</td>
            <td class="col-hex">${hexVal}</td>
            <td class="col-dec">
                <input 
                    type="text" 
                    class="reg-dec-input" 
                    data-reg="${i}" 
                    value="${regVal}" 
                >
            </td>
        `;

        // Actualizar registro cuando escriban en el input
        tr.querySelector("input").addEventListener("change", e => {
            let val = parseInt(e.target.value);
            if (i === 0) val = 0;
            if (Number.isNaN(val)) val = 0;
            cpu.state.regs[i] = val >>> 0;
            renderRegisters();
        });

        tbody.appendChild(tr);
    }
}

/* ============================================================
   RENDER MEMORY (AMBAS VISTAS)
============================================================ */
let memoryAccessCount = 0;
let lastMemoryAddr = null;
let lastMemoryOp = '--';

function renderMemory() {
    renderMemoryGrid();
    renderMemoryTable();
}

function renderMemoryGrid() {
    const grid = document.getElementById('memory-grid');
    if (!grid) return;
    
    grid.innerHTML = '';

    for (let i = 0; i < 32; i++) {
        const memAddr = i * 4;
        const memVal = cpu.state.dataMem[i] >>> 0;
        const hexVal = memVal.toString(16).toUpperCase().padStart(8, '0');
        const decVal = memVal.toString();

        const cell = document.createElement('div');
        cell.className = 'memory-cell' + (lastMemoryAddr === memAddr ? ' active' : '');
        cell.innerHTML = `
            <div class="memory-cell-addr">0x${memAddr.toString(16).toUpperCase().padStart(2, '0')}</div>
            <div class="memory-cell-value">${hexVal}</div>
            <div class="memory-cell-dec">${decVal > 1000 ? (decVal / 1000).toFixed(1) + 'K' : decVal}</div>
        `;
        
        cell.addEventListener('click', () => {
            showMemoryDetail(i, memVal);
        });
        
        grid.appendChild(cell);
    }
}

function renderMemoryTable() {
    const tbody = document.querySelector('#memory-table tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';

    for (let i = 0; i < 32; i++) {
        const memAddr = i * 4;
        const memVal = cpu.state.dataMem[i] >>> 0;
        const hexVal = '0x' + memVal.toString(16).toUpperCase().padStart(8, '0');
        const decVal = memVal.toString();

        const tr = document.createElement('tr');
        tr.className = lastMemoryAddr === memAddr ? 'memory-active' : '';

        tr.innerHTML = `
            <td class="col-addr">0x${memAddr.toString(16).toUpperCase().padStart(2, '0')}</td>
            <td class="col-offset">[${i}]</td>
            <td class="col-hex">${hexVal}</td>
            <td class="col-dec">${decVal}</td>
        `;

        tbody.appendChild(tr);
    }
}

function showMemoryDetail(index, value) {
    // Aquí se puede agregar un tooltip o modal con más detalles
    console.log(`Memory[${index}] = 0x${value.toString(16).padStart(8, '0')} (${value})`);
}

function updateMemoryStats(lastAddr, operation = 'READ') {
    if (lastAddr !== null && lastAddr !== lastMemoryAddr) {
        memoryAccessCount++;
        lastMemoryAddr = lastAddr;
        lastMemoryOp = operation;
        
        document.getElementById('memory-access-count').textContent = memoryAccessCount;
        document.getElementById('memory-last-addr').textContent = '0x' + lastAddr.toString(16).toUpperCase().padStart(2, '0');
        document.getElementById('memory-last-op').textContent = operation;
    }
}


