/**
 * 8BitDo Retro Numpad Calculator
 * Supports full order-of-operations (PEMDAS), keyboard shortcuts, sign toggle,
 * percentage calculations, power/mode switch, and tactile mechanical audio.
 */

(() => {
    const displayEl = document.getElementById('display');
    const expressionEl = document.getElementById('expression');
    const lcdScreenEl = document.getElementById('lcd-screen');
    const powerIndicatorEl = document.getElementById('power-indicator');

    const modeDialBtn = document.getElementById('mode-dial');
    const modeLabels = document.querySelectorAll('[data-mode-label]');
    const soundBtn = document.getElementById('btn-sound');
    const soundLed = document.getElementById('led-sound');
    const signBtn = document.getElementById('btn-sign');
    const percentBtn = document.getElementById('btn-percent');

    const state = {
        tokens: [],
        currentInput: '0',
        justEvaluated: false,
        hasError: false,
        modes: ['BT', 'OFF', '2.4'],
        modeIndex: 2, // Default: 2.4G ON
        soundEnabled: true
    };

    /* ----------------------------------------------------------------------
       Web Audio API Tactile Mechanical Switch Sound
       ---------------------------------------------------------------------- */
    let audioCtx = null;

    function playKeyClick(isEnter = false) {
        if (!state.soundEnabled || isPoweredOff()) return;
        try {
            if (!audioCtx) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                audioCtx = new AudioContextClass();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }

            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(isEnter ? 220 : 320, now);
            osc.frequency.exponentialRampToValueAtTime(isEnter ? 75 : 110, now + 0.032);

            gain.gain.setValueAtTime(0.09, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start(now);
            osc.stop(now + 0.036);
        } catch (_) {
            // Silently ignore if browser blocks audio before interaction
        }
    }

    function isPoweredOff() {
        return state.modes[state.modeIndex] === 'OFF';
    }

    /* ----------------------------------------------------------------------
       Display Formatting & Rendering
       ---------------------------------------------------------------------- */
    function formatOperatorSymbol(op) {
        switch (op) {
            case '/': return '÷';
            case '*': return '×';
            case '-': return '−';
            case '+': return '+';
            default: return op;
        }
    }

    function formatNumberDisplay(valStr) {
        if (valStr === 'ERR' || valStr === 'DIV 0') return valStr;
        if (valStr.endsWith('.')) return valStr;

        const num = Number(valStr);
        if (!Number.isFinite(num)) return 'ERR';

        // Keep exact decimal entry while typing (e.g. "0.00")
        if (valStr.includes('.') && !state.justEvaluated) {
            return valStr.slice(0, 12);
        }

        const abs = Math.abs(num);
        if (abs !== 0 && (abs >= 1e9 || abs < 1e-6)) {
            return num.toExponential(4).replace('+', '');
        }

        const rounded = Math.round(num * 1e8) / 1e8;
        return String(rounded).slice(0, 11);
    }

    function updateScreen() {
        const formattedMain = formatNumberDisplay(state.currentInput);
        displayEl.textContent = formattedMain;

        displayEl.classList.toggle('compact', formattedMain.length > 8);
        displayEl.classList.toggle('error-state', state.hasError);

        if (state.tokens.length > 0) {
            const exprText = state.tokens
                .map((tok, idx) => (idx % 2 === 1 ? formatOperatorSymbol(tok) : formatNumberDisplay(tok)))
                .join(' ');
            expressionEl.textContent = exprText;
        } else {
            expressionEl.textContent = '';
        }
    }

    /* ----------------------------------------------------------------------
       Safe Shunting-Yard / Precedence Evaluator (No eval())
       ---------------------------------------------------------------------- */
    function evaluateTokens(tokens) {
        if (tokens.length === 0) return 0;

        // Pass 1: Multiplication and Division
        const pass1 = [parseFloat(tokens[0])];
        for (let i = 1; i < tokens.length; i += 2) {
            const op = tokens[i];
            const nextVal = parseFloat(tokens[i + 1]);

            if (Number.isNaN(nextVal)) throw new Error('SYNTAX');

            if (op === '*' || op === '/') {
                const prevVal = pass1.pop();
                if (op === '/') {
                    if (nextVal === 0) throw new Error('DIV_ZERO');
                    pass1.push(prevVal / nextVal);
                } else {
                    pass1.push(prevVal * nextVal);
                }
            } else {
                pass1.push(op, nextVal);
            }
        }

        // Pass 2: Addition and Subtraction
        let result = pass1[0];
        for (let i = 1; i < pass1.length; i += 2) {
            const op = pass1[i];
            const nextVal = pass1[i + 1];
            if (op === '+') result += nextVal;
            if (op === '-') result -= nextVal;
        }

        if (!Number.isFinite(result)) throw new Error('OVERFLOW');
        return result;
    }

    /* ----------------------------------------------------------------------
       Calculator Core Operations
       ---------------------------------------------------------------------- */
    function resetCalculator() {
        state.tokens = [];
        state.currentInput = '0';
        state.justEvaluated = false;
        state.hasError = false;
        updateScreen();
    }

    function inputDigit(digit) {
        if (isPoweredOff()) return;
        playKeyClick(false);

        if (state.hasError || state.justEvaluated) {
            state.tokens = [];
            state.currentInput = digit;
            state.justEvaluated = false;
            state.hasError = false;
            updateScreen();
            return;
        }

        if (state.currentInput === '0') {
            state.currentInput = digit;
        } else if (state.currentInput === '-0') {
            state.currentInput = '-' + digit;
        } else if (state.currentInput.replace(/[^0-9]/g, '').length < 10) {
            state.currentInput += digit;
        }
        updateScreen();
    }

    function inputDecimal() {
        if (isPoweredOff()) return;
        playKeyClick(false);

        if (state.hasError || state.justEvaluated) {
            state.tokens = [];
            state.currentInput = '0.';
            state.justEvaluated = false;
            state.hasError = false;
            updateScreen();
            return;
        }

        if (!state.currentInput.includes('.')) {
            state.currentInput += '.';
            updateScreen();
        }
    }

    function inputOperator(op) {
        if (isPoweredOff()) return;
        playKeyClick(false);

        if (state.hasError) {
            resetCalculator();
            return;
        }

        if (state.justEvaluated) {
            state.tokens = [state.currentInput, op];
            state.currentInput = '0';
            state.justEvaluated = false;
            updateScreen();
            return;
        }

        // Replace trailing operator if user switches operator before typing next number
        if (state.tokens.length >= 2 && state.currentInput === '0' && expressionEl.textContent.endsWith(formatOperatorSymbol(state.tokens[state.tokens.length - 1]))) {
            // Only replace if user hasn't explicitly entered '0' as the second operand
            if (!state.explicitZero) {
                state.tokens[state.tokens.length - 1] = op;
                updateScreen();
                return;
            }
        }

        const cleanOperand = String(parseFloat(state.currentInput));
        state.tokens.push(cleanOperand, op);
        state.currentInput = '0';
        state.explicitZero = false;
        updateScreen();
    }

    function calculateResult() {
        if (isPoweredOff()) return;
        playKeyClick(true);

        if (state.hasError) {
            resetCalculator();
            return;
        }

        if (state.tokens.length === 0) {
            state.justEvaluated = true;
            updateScreen();
            return;
        }

        const fullTokens = [...state.tokens, String(parseFloat(state.currentInput))];
        try {
            const value = evaluateTokens(fullTokens);
            expressionEl.textContent = fullTokens
                .map((tok, idx) => (idx % 2 === 1 ? formatOperatorSymbol(tok) : formatNumberDisplay(tok)))
                .join(' ') + ' =';
            state.tokens = [];
            state.currentInput = String(Math.round(value * 1e8) / 1e8);
            state.justEvaluated = true;
            state.hasError = false;

            const formattedMain = formatNumberDisplay(state.currentInput);
            displayEl.textContent = formattedMain;
            displayEl.classList.toggle('compact', formattedMain.length > 8);
            displayEl.classList.remove('error-state');
        } catch (err) {
            state.tokens = [];
            state.currentInput = err.message === 'DIV_ZERO' ? 'DIV 0' : 'ERR';
            state.hasError = true;
            state.justEvaluated = false;
            updateScreen();
        }
    }

    function backspace() {
        if (isPoweredOff()) return;
        playKeyClick(false);

        if (state.hasError || state.justEvaluated) {
            resetCalculator();
            return;
        }

        if (state.currentInput.length <= 1 || (state.currentInput.length === 2 && state.currentInput.startsWith('-'))) {
            state.currentInput = '0';
        } else {
            state.currentInput = state.currentInput.slice(0, -1);
        }
        updateScreen();
    }

    function toggleSign() {
        if (isPoweredOff()) return;
        playKeyClick(false);

        if (state.hasError) {
            resetCalculator();
            return;
        }

        if (state.currentInput === '0' || state.currentInput === '0.') return;

        if (state.currentInput.startsWith('-')) {
            state.currentInput = state.currentInput.slice(1);
        } else {
            state.currentInput = '-' + state.currentInput;
        }
        state.justEvaluated = false;
        updateScreen();
    }

    function applyPercentage() {
        if (isPoweredOff()) return;
        playKeyClick(false);

        if (state.hasError) {
            resetCalculator();
            return;
        }

        const currentVal = parseFloat(state.currentInput);
        if (Number.isNaN(currentVal)) return;

        // Context-aware percentage: e.g., 200 + 10% -> 200 + 20
        if (state.tokens.length >= 2) {
            const baseVal = parseFloat(state.tokens[state.tokens.length - 2]);
            const pendingOp = state.tokens[state.tokens.length - 1];
            if ((pendingOp === '+' || pendingOp === '-') && !Number.isNaN(baseVal)) {
                state.currentInput = String(Math.round((baseVal * (currentVal / 100)) * 1e8) / 1e8);
                updateScreen();
                return;
            }
        }

        state.currentInput = String(Math.round((currentVal / 100) * 1e8) / 1e8);
        state.justEvaluated = false;
        updateScreen();
    }

    /* ----------------------------------------------------------------------
       Top Hardware Controls (Mode Dial, Sound Toggle, +/- & % Keys)
       ---------------------------------------------------------------------- */
    function cycleModeDial() {
        state.modeIndex = (state.modeIndex + 1) % state.modes.length;
        const currentMode = state.modes[state.modeIndex];

        modeDialBtn.classList.remove('pos-bt', 'pos-off', 'pos-24');
        if (currentMode === 'BT') modeDialBtn.classList.add('pos-bt');
        if (currentMode === 'OFF') modeDialBtn.classList.add('pos-off');
        if (currentMode === '2.4') modeDialBtn.classList.add('pos-24');

        modeDialBtn.setAttribute('aria-label', `Mode selector dial: ${currentMode}`);
        modeLabels.forEach((lbl) => {
            lbl.classList.toggle('active', lbl.dataset.modeLabel === currentMode);
        });

        const off = currentMode === 'OFF';
        lcdScreenEl.classList.toggle('powered-off', off);
        powerIndicatorEl.style.opacity = off ? '0.2' : '1';
        soundLed.classList.toggle('active', !off && state.soundEnabled);
        document.getElementById('led-cal').classList.toggle('active', !off);

        if (!off) {
            playKeyClick(false);
            resetCalculator();
        }
    }

    modeDialBtn.addEventListener('click', cycleModeDial);

    soundBtn.addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        soundBtn.classList.toggle('active', state.soundEnabled);
        soundLed.classList.toggle('active', !isPoweredOff() && state.soundEnabled);
        if (state.soundEnabled) playKeyClick(false);
    });

    signBtn.addEventListener('click', toggleSign);
    percentBtn.addEventListener('click', applyPercentage);

    /* ----------------------------------------------------------------------
       Keypad Pointer & Keyboard Event Binding
       ---------------------------------------------------------------------- */
    document.querySelectorAll('.keycap').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.dataset.digit !== undefined) {
                if (btn.dataset.digit === '0' && state.currentInput === '0') {
                    state.explicitZero = true;
                }
                inputDigit(btn.dataset.digit);
            } else if (btn.dataset.operator !== undefined) {
                inputOperator(btn.dataset.operator);
            } else if (btn.dataset.action === 'decimal') {
                inputDecimal();
            } else if (btn.dataset.action === 'clear') {
                playKeyClick(false);
                resetCalculator();
            } else if (btn.dataset.action === 'backspace') {
                backspace();
            } else if (btn.dataset.action === 'equals') {
                calculateResult();
            }
        });
    });

    function flashVisualPress(selector) {
        const el = document.querySelector(selector);
        if (!el) return;
        el.classList.add('pressed');
        setTimeout(() => el.classList.remove('pressed'), 110);
    }

    window.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (/^[0-9]$/.test(e.key)) {
            e.preventDefault();
            flashVisualPress(`[data-digit="${e.key}"]`);
            if (e.key === '0' && state.currentInput === '0') state.explicitZero = true;
            inputDigit(e.key);
        } else if (e.key === '.' || e.key === ',') {
            e.preventDefault();
            flashVisualPress('[data-action="decimal"]');
            inputDecimal();
        } else if (['+', '-', '*', '/'].includes(e.key)) {
            e.preventDefault();
            flashVisualPress(`[data-operator="${e.key}"]`);
            inputOperator(e.key);
        } else if (e.key === 'Enter' || e.key === '=') {
            e.preventDefault();
            flashVisualPress('[data-action="equals"]');
            calculateResult();
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            flashVisualPress('[data-action="backspace"]');
            backspace();
        } else if (e.key === 'Escape' || e.key.toLowerCase() === 'c') {
            e.preventDefault();
            flashVisualPress('[data-action="clear"]');
            playKeyClick(false);
            resetCalculator();
        } else if (e.key === '%') {
            e.preventDefault();
            flashVisualPress('#btn-percent');
            applyPercentage();
        }
    });

    // Initialize screen state
    updateScreen();
})();
