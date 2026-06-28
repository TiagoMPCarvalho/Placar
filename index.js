(function () {
    'use strict';

    // --- ESTADOS DO JOGO (Encapsulados contra alterações via Console) ---
    let scoreA = 0;             // Pontos Azul
    let scoreB = 0;             // Pontos Vermelho
    let maxScore = 15;          // Limite selecionado (12, 15, 18, 21)
    let gameActive = false;     // Se o jogo está rolando
    let pointHistory = [];      // Guarda histórico de estados completo para Desfazer
    let scoreboardStyle = 'digital'; // 'digital' ou 'modern'
    let lastScorer = null;      // Último a marcar ('blue', 'red', null)
    let phase = 'normal';       // Fases: 'normal' | 'melhor_de_2_1' | 'melhor_de_2_2' | 'melhor_de_3'
    
    let wakeLock = null;
    let audioCtx = null;

    // --- CONTROLE DE TEMPO DE PARTIDA ---
    let matchStartTime = null;
    let matchTimerInterval = null;
    let currentTimerStr = "00:00";

    // --- CONTROLE DE BLOQUEIO DE TELA (CADEADO) ---
    let isLocked = false;
    let lastClickTimeBlue = 0;
    let lastClickTimeRed = 0;
    const DOUBLE_TAP_DELAY = 300;
    let lockHintTimeout = null;
    let manualInterval = null;
    let manualActive = false;

    // --- CONTROLE DE COMBINAÇÃO DE CORES ---
    let activeBlueColor = '#0000ff';
    let activeRedColor = '#ff0000';
    let colorPreset = 'principal';

    const COLOR_PRESETS = {
        principal: { blue: '#0000ff', red: '#ff0000' },
        escuro:    { blue: '#0a142c', red: '#2c0a0a' }
    };

    function applyColors() {
        const container = document.getElementById('app-container');
        container.style.setProperty('--bg-blue', activeBlueColor);
        container.style.setProperty('--bg-red', activeRedColor);
    }

    function showLockHint() {
        const hint = document.getElementById('lockHint');
        hint.classList.add('show');
        if (lockHintTimeout) clearTimeout(lockHintTimeout);
        lockHintTimeout = setTimeout(() => {
            hint.classList.remove('show');
        }, 1000);
    }

    function showManualOverlay() {
        const overlay = document.getElementById('manualOverlay');
        const leftPtr = document.getElementById('leftPointer');
        const rightPtr = document.getElementById('rightPointer');
        
        // Limpa estados
        leftPtr.classList.remove('tap-active');
        rightPtr.classList.remove('tap-active');
        if (manualInterval) clearInterval(manualInterval);
        
        overlay.style.display = 'flex';
        void overlay.offsetWidth; // Força reflow
        overlay.classList.add('show');
        manualActive = true;
        
        // Dispara a primeira animação de toque duplo
        leftPtr.classList.add('tap-active');
        rightPtr.classList.add('tap-active');
        
        setTimeout(() => {
            leftPtr.classList.remove('tap-active');
            rightPtr.classList.remove('tap-active');
        }, 1500);
        
        // Loop infinito a cada 5 segundos
        manualInterval = setInterval(() => {
            leftPtr.classList.add('tap-active');
            rightPtr.classList.add('tap-active');
            setTimeout(() => {
                leftPtr.classList.remove('tap-active');
                rightPtr.classList.remove('tap-active');
            }, 1500);
        }, 5000);
    }

    function hideManualOverlay() {
        if (!manualActive) return;
        manualActive = false;
        
        if (manualInterval) {
            clearInterval(manualInterval);
            manualInterval = null;
        }
        
        const overlay = document.getElementById('manualOverlay');
        overlay.classList.remove('show');
        setTimeout(() => {
            overlay.style.display = 'none';
        }, 400); // Aguarda o fade-out do CSS
    }

    function toggleLock() {
        isLocked = !isLocked;
        const btn = document.getElementById('lockBtn');
        if (isLocked) {
            btn.classList.add('locked');
            btn.innerHTML = '&#128274;'; // Cadeado Fechado 🔒
        } else {
            btn.classList.remove('locked');
            btn.innerHTML = '&#128275;'; // Cadeado Aberto 🔓
        }
        playClickSound();
    }

    function handleTeamClick(team) {
        if (!gameActive) return;
        if (isLocked) {
            const now = Date.now();
            if (team === 'blue') {
                if (now - lastClickTimeBlue < DOUBLE_TAP_DELAY) {
                    addPoint('blue');
                    lastClickTimeBlue = 0;
                } else {
                    lastClickTimeBlue = now;
                    showLockHint();
                }
            } else {
                if (now - lastClickTimeRed < DOUBLE_TAP_DELAY) {
                    addPoint('red');
                    lastClickTimeRed = 0;
                } else {
                    lastClickTimeRed = now;
                    showLockHint();
                }
            }
        } else {
            addPoint(team);
        }
    }

    function updateMatchTimer() {
        if (!matchStartTime) return;
        const elapsed = Math.floor((Date.now() - matchStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        currentTimerStr = `${minutes}:${seconds}`;
        
        if (gameActive) {
            updateDisplayBanner();
        }
    }

    function updateDisplayBanner() {
        let phaseText = "PARTIDA NORMAL";
        if (phase === 'melhor_de_2_1' || phase === 'melhor_de_2_2') {
            phaseText = "MELHOR DE 2";
        } else if (phase === 'melhor_de_3') {
            phaseText = "MELHOR DE 3";
        }
        
        const fullText = `${phaseText} • ${currentTimerStr}`;
        document.getElementById('phaseLabel').innerText = fullText;
        document.getElementById('phaseLabelTie').innerText = fullText;
    }

    // --- SISTEMA DE ÁUDIO SINTETIZADO ---
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playClickSound() {
        initAudio();
        if (!audioCtx) return;
        try {
            const bufferSize = audioCtx.sampleRate * 0.035;
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            
            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;
            
            const gainNode = audioCtx.createGain();
            gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.03);
            
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1100;
            filter.Q.value = 2.5;
            
            noise.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            const osc = audioCtx.createOscillator();
            const oscGain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(130, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.015);
            
            oscGain.gain.setValueAtTime(0.07, audioCtx.currentTime);
            oscGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.015);
            
            osc.connect(oscGain);
            oscGain.connect(audioCtx.destination);
            
            noise.start();
            osc.start();
            noise.stop(audioCtx.currentTime + 0.035);
            osc.stop(audioCtx.currentTime + 0.035);
        } catch (e) {
            console.log("Falha ao reproduzir áudio:", e);
        }
    }

    function playChimeSound() {
        initAudio();
        if (!audioCtx) return;
        try {
            const now = audioCtx.currentTime;
            
            const playNote = (freq, time, duration) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, time);
                
                gain.gain.setValueAtTime(0.08, time);
                gain.gain.exponentialRampToValueAtTime(0.001, time + duration - 0.02);
                
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                
                osc.start(time);
                osc.stop(time + duration);
            };
            
            playNote(261.63, now, 0.15);       // Do4
            playNote(329.63, now + 0.08, 0.15); // Mi4
            playNote(392.00, now + 0.16, 0.3);  // Sol4
        } catch(e) {}
    }

    // --- SISTEMA DE TEMAS ---
    function setTheme(theme) {
        scoreboardStyle = theme;
        const container = document.getElementById('app-container');
        const btnRustic = document.getElementById('btnThemeDigital');
        const btnModern = document.getElementById('btnThemeModern');
        
        if (theme === 'digital') {
            container.classList.remove('theme-modern');
            container.classList.add('theme-digital');
            btnRustic.classList.add('active');
            btnModern.classList.remove('active');
        } else {
            container.classList.remove('theme-digital');
            container.classList.add('theme-modern');
            btnModern.classList.add('active');
            btnRustic.classList.remove('active');
        }
        updateDisplay(false);
    }

    // --- LÓGICA DE JOGO ---
    function startGame(points) {
        maxScore = points;
        scoreA = 0;
        scoreB = 0;
        phase = 'normal';
        lastScorer = null;
        pointHistory = [];
        gameActive = true;
        
        // Inicializa e inicia o cronômetro
        matchStartTime = Date.now();
        currentTimerStr = "00:00";
        if (matchTimerInterval) clearInterval(matchTimerInterval);
        matchTimerInterval = setInterval(updateMatchTimer, 1000);
        
        updateDisplay(false);

        document.getElementById('setup').style.display = 'none';
        document.getElementById('scoreboard').style.display = 'flex';
        document.getElementById('winnerModal').style.display = 'none';
        document.getElementById('undoBtn').style.display = 'flex';
        document.getElementById('lockBtn').style.display = 'flex';

        requestWakeLock();
        initAudio();

        // 1. Mostrar o Manual de Clique com Animação
        showManualOverlay();

        // 2. Bloqueio automático do cadeado após 2 segundos
        setTimeout(() => {
            if (gameActive && !isLocked) {
                toggleLock();
            }
        }, 2000);

        history.pushState({ page: 'scoreboard' }, 'Placar', '#placar');
    }

    function setCardValue(cardId, elementId, bgElementId, newValue, animate = true) {
        const card = document.getElementById(cardId);
        const elem = document.getElementById(elementId);
        const bgElem = document.getElementById(bgElementId);
        
        if (!card || !elem) {
            if (elem) elem.innerHTML = newValue;
            return;
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newValue;
        const rawText = tempDiv.textContent || tempDiv.innerText || "";
        const bgValue = '8'.repeat(rawText.length);
        
        if (animate) {
            playClickSound();
            card.classList.remove('flipping');
            void card.offsetWidth; // Força reflow
            card.classList.add('flipping');
            
            setTimeout(() => {
                elem.innerHTML = newValue;
                if (bgElem) bgElem.innerHTML = bgValue;
            }, 150);
        } else {
            elem.innerHTML = newValue;
            if (bgElem) bgElem.innerHTML = bgValue;
        }
    }

    function showAnnouncement(title, text) {
        const overlay = document.getElementById('announcementOverlay');
        const titleEl = document.getElementById('announcementTitle');
        const textEl = document.getElementById('announcementText');
        
        titleEl.innerText = title;
        textEl.innerText = text;
        
        overlay.style.display = 'flex';
        void overlay.offsetWidth;
        overlay.classList.add('show');
        
        playChimeSound();
        
        setTimeout(() => {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 300);
        }, 2000);
    }

    function addPoint(team) {
        if (!gameActive) return;

        // Esconde a animação de tutorial ao pontuar com sucesso
        hideManualOverlay();

        pointHistory.push({
            scoreA: scoreA,
            scoreB: scoreB,
            phase: phase,
            lastScorer: lastScorer,
            gameActive: gameActive
        });

        if (team === 'blue') {
            scoreA++;
            lastScorer = 'blue';
        } else if (team === 'red') {
            scoreB++;
            lastScorer = 'red';
        } else {
            return;
        }

        let target = maxScore;
        if (phase === 'melhor_de_2_1' || phase === 'melhor_de_2_2') {
            target = 2;
        } else if (phase === 'melhor_de_3') {
            target = 3;
        }

        const tiroScore = target - 1;

        if (scoreA === tiroScore && scoreB === tiroScore) {
            scoreA = 0;
            scoreB = 0;
            
            let title = "TIRO A TIRO!";
            let subtitle = "";
            
            if (phase === 'normal') {
                phase = 'melhor_de_2_1';
                subtitle = `Empate em ${tiroScore}x${tiroScore}! Placar zerou: Melhor de 2.`;
            } else if (phase === 'melhor_de_2_1') {
                phase = 'melhor_de_2_2';
                subtitle = "Empate em 1x1! Placar zerou: Melhor de 2 dnv.";
            } else if (phase === 'melhor_de_2_2') {
                phase = 'melhor_de_3';
                title = "MELHOR DE 3!";
                subtitle = "Tiro a tiro dnv! Placar zerou: Melhor de 3.";
            } else if (phase === 'melhor_de_3') {
                phase = 'melhor_de_2_1';
                subtitle = "Empate em 2x2! Placar zerou: volta para Melhor de 2.";
            }
            
            showAnnouncement(title, subtitle);
            afterChange(false);
            return;
        }

        if (scoreA >= target || scoreB >= target) {
            gameActive = false;
            afterChange(true);
            return;
        }

        afterChange(true);
    }

    function undo() {
        if (pointHistory.length === 0) return;
        const prevState = pointHistory.pop();
        
        scoreA = prevState.scoreA;
        scoreB = prevState.scoreB;
        phase = prevState.phase;
        lastScorer = prevState.lastScorer;
        gameActive = prevState.gameActive;
        
        afterChange(false);
    }

    function afterChange(animate = true) {
        updateDisplay(animate);

        let target = maxScore;
        if (phase === 'melhor_de_2_1' || phase === 'melhor_de_2_2') {
            target = 2;
        } else if (phase === 'melhor_de_3') {
            target = 3;
        }

        if (scoreA >= target || scoreB >= target) {
            gameActive = false;
            if (matchTimerInterval) {
                clearInterval(matchTimerInterval);
                matchTimerInterval = null;
            }
            const blueWon = scoreA >= target;
            showWinner(blueWon, blueWon ? activeBlueColor : activeRedColor);
        } else {
            if (pointHistory.length === 0 || pointHistory[pointHistory.length - 1].gameActive) {
                gameActive = true;
                document.getElementById('winnerModal').style.display = 'none';
                if (!matchTimerInterval) {
                    matchTimerInterval = setInterval(updateMatchTimer, 1000);
                }
            }
        }
    }

    function updateDisplay(animate = true) {
        const tie = document.getElementById('tieDisplay');
        
        updateDisplayBanner();

        let target = maxScore;
        if (phase === 'melhor_de_2_1' || phase === 'melhor_de_2_2') {
            target = 2;
        } else if (phase === 'melhor_de_3') {
            target = 3;
        }
        const tiroScore = target - 1;

        const blueTiro = (scoreA === tiroScore && scoreB < tiroScore);
        const redTiro = (scoreB === tiroScore && scoreA < tiroScore);
        
        const indicatorBlue = document.getElementById('tiroBlue');
        const indicatorRed = document.getElementById('tiroRed');

        if (blueTiro) indicatorBlue.classList.add('active');
        else indicatorBlue.classList.remove('active');

        if (redTiro) indicatorRed.classList.add('active');
        else indicatorRed.classList.remove('active');

        const arrow = document.getElementById('scorerIndicator');
        if (lastScorer === 'blue') {
            arrow.className = 'scorer-indicator active blue-last';
        } else if (lastScorer === 'red') {
            arrow.className = 'scorer-indicator active red-last';
        } else {
            arrow.className = 'scorer-indicator';
        }

        if (scoreA === scoreB && gameActive) {
            const tieContent = scoreA + '<span class="a">A</span>';
            setCardValue('cardTie', 'tieNumber', 'tieNumberBg', tieContent, animate);
            
            setCardValue('cardBlue', 'scoreBlue', 'scoreBlueBg', scoreA, false);
            setCardValue('cardRed', 'scoreRed', 'scoreRedBg', scoreB, false);
            
            tie.style.display = 'flex';
        } else {
            tie.style.display = 'none';
            setCardValue('cardBlue', 'scoreBlue', 'scoreBlueBg', scoreA, animate && lastScorer === 'blue');
            setCardValue('cardRed', 'scoreRed', 'scoreRedBg', scoreB, animate && lastScorer === 'red');
        }
    }

    function showWinner(blueWon, color) {
        const modal = document.getElementById('winnerModal');
        const msg = document.getElementById('winnerMessage');
        
        if (colorPreset === 'custom') {
            msg.innerText = blueWon ? "LADO ESQUERDO VENCEU" : "LADO DIREITO VENCEU";
        } else {
            msg.innerText = blueWon ? "TIME AZUL VENCEU" : "TIME VERMELHO VENCEU";
        }
        msg.style.color = color;
        
        document.getElementById('winnerTime').innerText = "Tempo de jogo: " + currentTimerStr;
        
        const panel = document.querySelector('.winner-panel');
        if (scoreboardStyle === 'modern') {
            msg.style.textShadow = `0 0 15px ${color}, 0 0 30px ${color}`;
            panel.style.boxShadow = `0 0 50px ${color}44, inset 0 0 20px rgba(255, 255, 255, 0.05)`;
        } else {
            msg.style.textShadow = '0 0 15px rgba(255, 255, 255, 0.2)';
            panel.style.boxShadow = '0 20px 50px rgba(0,0,0,0.6)';
        }
        
        document.getElementById('tieDisplay').style.display = 'none';
        modal.style.display = 'flex';
    }

    function goBack() {
        if (document.getElementById('scoreboard').style.display === 'flex') {
            history.back();
        } else {
            resetToSetup();
        }
    }

    function resetToSetup() {
        gameActive = false;
        pointHistory = [];
        lastScorer = null;
        
        if (matchTimerInterval) {
            clearInterval(matchTimerInterval);
            matchTimerInterval = null;
        }

        // Reseta o cadeado
        isLocked = false;
        const lockBtn = document.getElementById('lockBtn');
        lockBtn.style.display = 'none';
        lockBtn.classList.remove('locked');
        lockBtn.innerHTML = '&#128275;'; // Unlocked 🔓

        // Reseta o manual de clique
        manualActive = false;
        if (manualInterval) {
            clearInterval(manualInterval);
            manualInterval = null;
        }
        document.getElementById('manualOverlay').classList.remove('show');
        document.getElementById('manualOverlay').style.display = 'none';
        
        releaseWakeLock();
        document.getElementById('setup').style.display = 'flex';
        document.getElementById('scoreboard').style.display = 'none';
        document.getElementById('tieDisplay').style.display = 'none';
        document.getElementById('winnerModal').style.display = 'none';
        document.getElementById('undoBtn').style.display = 'none';
    }

    // --- SISTEMA WAKELOCK (MANTÉM TELA ACESA) ---
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (e) {}
    }
    function releaseWakeLock() {
        try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
    }

    // --- MODO TELA CHEIA & TRAVA ORIENTAÇÃO NATIVA ---
    async function toggleFullscreen() {
        const el = document.documentElement;
        const isFull = document.fullscreenElement || document.webkitFullscreenElement;
        try {
            if (!isFull) {
                if (el.requestFullscreen) {
                    await el.requestFullscreen();
                } else if (el.webkitRequestFullscreen) {
                    await el.webkitRequestFullscreen();
                }
                if (screen.orientation && screen.orientation.lock) {
                    await screen.orientation.lock('landscape').catch(() => {});
                }
            } else {
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    await document.webkitExitFullscreen();
                }
                if (screen.orientation && screen.orientation.unlock) {
                    screen.orientation.unlock();
                }
            }
        } catch (e) {
            console.log(e);
        }
    }

    function updateFsIcon() {
        const isFull = document.fullscreenElement || document.webkitFullscreenElement;
        document.getElementById('fsBtn').innerHTML = isFull ? '&#10006;' : '&#9974;';
    }

    // --- BINDING DE EVENTOS DINÂMICOS (Segurança/CSP) ---
    document.addEventListener('DOMContentLoaded', () => {


        // Seleção de Combinação de Cores
        document.querySelectorAll('.color-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.color-preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const preset = btn.getAttribute('data-preset');
                colorPreset = preset;
                
                const customSelectors = document.getElementById('customColorSelectors');
                if (preset === 'custom') {
                    customSelectors.style.display = 'flex';
                    activeBlueColor = document.getElementById('customColorLeft').value;
                    activeRedColor = document.getElementById('customColorRight').value;
                } else {
                    customSelectors.style.display = 'none';
                    activeBlueColor = COLOR_PRESETS[preset].blue;
                    activeRedColor = COLOR_PRESETS[preset].red;
                }
                applyColors();
            });
        });

        // Ouvintes para seletores personalizados de cores
        document.getElementById('customColorLeft').addEventListener('input', (e) => {
            if (colorPreset === 'custom') {
                activeBlueColor = e.target.value;
                applyColors();
            }
        });
        document.getElementById('customColorRight').addEventListener('input', (e) => {
            if (colorPreset === 'custom') {
                activeRedColor = e.target.value;
                applyColors();
            }
        });

        // Escolha de Limite de Jogo
        document.querySelectorAll('.btn-start-score').forEach(btn => {
            btn.addEventListener('click', () => {
                const points = parseInt(btn.getAttribute('data-points'), 10);
                startGame(points);
            });
        });

        // Clique para pontuar
        document.getElementById('teamBlue').addEventListener('click', () => handleTeamClick('blue'));
        document.getElementById('teamRed').addEventListener('click', () => handleTeamClick('red'));
        document.getElementById('tieHalfBlue').addEventListener('click', () => handleTeamClick('blue'));
        document.getElementById('tieHalfRed').addEventListener('click', () => handleTeamClick('red'));

        // Controles de tela
        document.getElementById('undoBtn').addEventListener('click', undo);
        document.getElementById('fsBtn').addEventListener('click', toggleFullscreen);
        document.getElementById('lockBtn').addEventListener('click', toggleLock);
        document.getElementById('newGameBtn').addEventListener('click', goBack);

        // Visibility Change (Wakelock)
        document.addEventListener('visibilitychange', () => {
            if (wakeLock !== null && document.visibilityState === 'visible' && gameActive) {
                requestWakeLock();
            }
        });

        // Fullscreen Changes
        document.addEventListener('fullscreenchange', updateFsIcon);
        document.addEventListener('webkitfullscreenchange', updateFsIcon);

        // Android back button / popstate
        window.addEventListener('popstate', () => {
            resetToSetup();
        });

        // Inicia com tema digital padrão e cores padrão
        setTheme('digital');
        applyColors();
    });

})();
