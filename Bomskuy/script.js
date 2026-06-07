// Konfigurasi Game
const GRID_COLS = 15;  // Lebar peta (sumbu X)
const GRID_ROWS = 9;   // Tinggi peta (sumbu Y)
const TILE_EMPTY = 0;
const TILE_PERMANENT = 1;
const TILE_BRICK = 2;
const TILE_STAR_NORMAL = 3;   // Bintang dari bata hancur (+10-30)
const TILE_STAR_SPECIAL = 4;  // Bintang dari musuh mati (+50-70)

let gameDuration = 60;        // Durasi dinamis berdasarkan level
const TOTAL_ENEMIES = 4;
const RESPAWN_DELAY = 5000;   // Delay respawn musuh: 5 detik

// Referensi DOM
const gameBoardElement = document.getElementById('game-board');
const welcomeScreen = document.getElementById('welcome-screen');
const btnStart = document.getElementById('btn-start');
const statusDisplay = document.getElementById('status-display');
const leaderboardList = document.getElementById('leaderboard-list');
const inputNameElement = document.getElementById('input-name');

// Referensi UI Tambahan
const nameDisplay = document.getElementById('player-name-display');
const healthDisplayUI = document.getElementById('health-display');
const timeDisplayUI = document.getElementById('time-display');
const scoreDisplayUI = document.getElementById('score-display');
const selectLevelElement = document.getElementById('select-level');
const levelDisplayUI = document.getElementById('level-display');
const winScreen = document.getElementById('win-screen');
const loseScreen = document.getElementById('lose-screen');
const winTimeDisplay = document.getElementById('win-time-display');
const loseScoreDisplay = document.getElementById('lose-score-display');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnTryAgain = document.getElementById('btn-try-again');
const btnMenuWin = document.getElementById('btn-menu-win');
const btnMenuLose = document.getElementById('btn-menu-lose');
const btnMute = document.getElementById('btn-mute');

// BGM Audio Setup
const bgmTracks = [
    new Audio('./Assets/King.mp3'),
    new Audio('./Assets/Drwn.mp3')
];
bgmTracks.forEach(track => {
    track.loop = true;
    track.volume = 0.4;
});
let currentTrack = null;
let isMuted = false;

function playRandomBGM() {
    if (currentTrack) return; // Keep playing if already playing
    const randomIndex = Math.floor(Math.random() * bgmTracks.length);
    currentTrack = bgmTracks[randomIndex];
    currentTrack.muted = isMuted;
    currentTrack.play().catch(err => {
        console.log("BGM playback was prevented: ", err);
    });
}

function stopBGM() {
    if (currentTrack) {
        currentTrack.pause();
        currentTrack.currentTime = 0;
        currentTrack = null;
    }
}

// Global first user interaction trigger to bypass strict browser autoplay policies
const initBGMOnInteraction = () => {
    playRandomBGM();
    document.removeEventListener('click', initBGMOnInteraction);
    document.removeEventListener('keydown', initBGMOnInteraction);
};
document.addEventListener('click', initBGMOnInteraction, { once: true });
document.addEventListener('keydown', initBGMOnInteraction, { once: true });

// State Game
let map = [];
let player = { x: 0, y: 0 };
let bombs = []; // [{x, y}]
let enemies = []; // [{x, y, dx, dy, ...}]
let currentScore = 0;
let playerHealth = 3;
let isInvulnerable = false;
let respawnTimeouts = []; // Daftar timeout respawn musuh
let selectedLevel = 1;

// State Timer & Kontrol
let gameActive = false;
let startTime = 0;
let timerInterval = null;
let enemyInterval = null;
let elapsedTime = 0;
let playerName = "";

/**
 * Fungsi utilitas
 */
function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function updateUI() {
    if (levelDisplayUI) levelDisplayUI.textContent = selectedLevel;
    nameDisplay.textContent = playerName || "-";
    healthDisplayUI.textContent = `${playerHealth} ♥`;
    const timeLeft = Math.max(0, gameDuration - elapsedTime);
    timeDisplayUI.textContent = formatTime(timeLeft);
    scoreDisplayUI.textContent = currentScore;
}

function takeDamage() {
    if (isInvulnerable || !gameActive) return;
    
    playerHealth--;
    updateUI();
    
    if (playerHealth <= 0) {
        gameOver();
        return;
    }
    
    isInvulnerable = true;
    renderGame();
    setTimeout(() => {
        isInvulnerable = false;
        renderGame();
    }, 2000);
}

/**
 * Logika Peta & Musuh
 */
function initMap() {
    map = [];

    for (let y = 0; y < GRID_ROWS; y++) {
        let row = [];
        for (let x = 0; x < GRID_COLS; x++) {
            if (x % 2 !== 0 && y % 2 !== 0) {
                row.push(TILE_PERMANENT);
            } else {
                const isSafeZone = (x === 0 && y === 0) || (x === 1 && y === 0) || (x === 0 && y === 1);
                if (!isSafeZone && Math.random() < 0.3) {
                    row.push(TILE_BRICK);
                } else {
                    row.push(TILE_EMPTY);
                }
            }
        }
        map.push(row);
    }
}

function spawnEnemies() {
    enemies = [];
    let count = 0;
    let attempts = 0;
    while (count < TOTAL_ENEMIES && attempts < 200) {
        attempts++;
        let x = Math.floor(Math.random() * GRID_COLS);
        let y = Math.floor(Math.random() * GRID_ROWS);
        
        const dist = Math.abs(x - player.x) + Math.abs(y - player.y);
        if (map[y][x] === TILE_EMPTY && dist > 5) {
            const dirs = [{dx:1, dy:0}, {dx:-1, dy:0}, {dx:0, dy:1}, {dx:0, dy:-1}];
            const dir = dirs[Math.floor(Math.random() * dirs.length)];
            enemies.push({
                x, y,
                dx: dir.dx, dy: dir.dy,
                lastBombTime: Date.now() + Math.random() * 2000,
                hasBomb: false,
                fleeSteps: 0
            });
            count++;
        }
    }
}

/**
 * Respawn satu musuh baru setelah jeda 5 detik.
 * Dipanggil setiap kali sebuah musuh mati terkena ledakan.
 */
function scheduleEnemyRespawn() {
    if (!gameActive) return;
    
    const timeoutId = setTimeout(() => {
        if (!gameActive) return;
        
        let attempts = 0;
        while (attempts < 100) {
            attempts++;
            let x = Math.floor(Math.random() * GRID_COLS);
            let y = Math.floor(Math.random() * GRID_ROWS);
            
            const dist = Math.abs(x - player.x) + Math.abs(y - player.y);
            const occupied = enemies.some(e => e.x === x && e.y === y);
            const hasBomb = bombs.some(b => b.x === x && b.y === y);
            
            if (map[y][x] === TILE_EMPTY && dist > 4 && !occupied && !hasBomb) {
                const dirs = [{dx:1, dy:0}, {dx:-1, dy:0}, {dx:0, dy:1}, {dx:0, dy:-1}];
                const dir = dirs[Math.floor(Math.random() * dirs.length)];
                enemies.push({
                    x, y,
                    dx: dir.dx, dy: dir.dy,
                    lastBombTime: Date.now() + Math.random() * 2000,
                    hasBomb: false,
                    fleeSteps: 0
                });
                renderGame();
                break;
            }
        }
    }, RESPAWN_DELAY);
    
    respawnTimeouts.push(timeoutId);
}

/**
 * Cek apakah posisi (cx, cy) berada dalam zona berbahaya bom mana pun.
 * Zona berbahaya = pusat bom + 2 kotak ke 4 arah (sesuai radius ledakan).
 */
function isInDangerZone(cx, cy) {
    return bombs.some(b => {
        if (b.x === cx && b.y === cy) return true;
        const dirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
        for (const {dx, dy} of dirs) {
            for (let i = 1; i <= 2; i++) {
                const tx = b.x + dx * i;
                const ty = b.y + dy * i;
                if (tx < 0 || tx >= GRID_COLS || ty < 0 || ty >= GRID_ROWS) break;
                if (map[ty][tx] === TILE_PERMANENT) break;
                if (tx === cx && ty === cy) return true;
                if (map[ty][tx] === TILE_BRICK) break;
            }
        }
        return false;
    });
}

/**
 * Cari arah yang aman untuk musuh bergerak.
 * Prioritas: arah yang keluar dari zona bahaya. Fallback: arah acak yang tidak terblokir.
 */
function getSafeDirection(enemy) {
    const allDirs = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];

    // Acak urutan arah agar pergerakan tidak terlalu mudah ditebak
    const shuffled = allDirs.sort(() => Math.random() - 0.5);

    // 1. Cari arah aman (tidak terblokir DAN tidak di zona bahaya)
    for (const dir of shuffled) {
        const nx = enemy.x + dir.dx;
        const ny = enemy.y + dir.dy;
        const blocked = nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS ||
                        map[ny][nx] === TILE_PERMANENT || map[ny][nx] === TILE_BRICK ||
                        bombs.some(b => b.x === nx && b.y === ny);
        if (!blocked && !isInDangerZone(nx, ny)) return dir;
    }

    // 2. Fallback: arah mana pun yang tidak terblokir secara fisik
    for (const dir of shuffled) {
        const nx = enemy.x + dir.dx;
        const ny = enemy.y + dir.dy;
        const blocked = nx < 0 || nx >= GRID_COLS || ny < 0 || ny >= GRID_ROWS ||
                        map[ny][nx] === TILE_PERMANENT || map[ny][nx] === TILE_BRICK ||
                        bombs.some(b => b.x === nx && b.y === ny);
        if (!blocked) return dir;
    }

    return null; // Terjebak total, diam di tempat
}

function moveEnemies() {
    enemies.forEach(enemy => {
        /*
         * === LOGIKA EVADE (Menghindar) ===
         * Setiap giliran, cek dulu apakah musuh sedang dalam zona berbahaya.
         * Jika ya, paksa musuh mencari arah aman menggunakan getSafeDirection().
         * Ini mencegah musuh mati konyol oleh bombnya sendiri.
         */
        const inDanger = isInDangerZone(enemy.x, enemy.y);
        if (inDanger || enemy.fleeSteps > 0) {
            // Mode EVADE/FLEE: cari arah yang menjauh dari zona bahaya
            const safeDir = getSafeDirection(enemy);
            if (safeDir) {
                enemy.dx = safeDir.dx;
                enemy.dy = safeDir.dy;
            }
            if (enemy.fleeSteps > 0) enemy.fleeSteps--;
        }

        // Tentukan langkah berikutnya
        let nextX = enemy.x + enemy.dx;
        let nextY = enemy.y + enemy.dy;

        const isBlocked = nextX < 0 || nextX >= GRID_COLS || nextY < 0 || nextY >= GRID_ROWS ||
                          map[nextY][nextX] === TILE_PERMANENT ||
                          map[nextY][nextX] === TILE_BRICK ||
                          bombs.some(b => b.x === nextX && b.y === nextY);

        if (isBlocked) {
            // Cari arah lain yang tidak terblokir
            const safeDir = getSafeDirection(enemy);
            if (safeDir) { enemy.dx = safeDir.dx; enemy.dy = safeDir.dy; }
        } else {
            enemy.x = nextX;
            enemy.y = nextY;
        }

        // Cek tabrakan dengan pemain
        if (enemy.x === player.x && enemy.y === player.y) {
            takeDamage();
        }

        /*
         * === LOGIKA BOM MUSUH ===
         * Kondisi menaruh bom:
         *   1. Tidak sedang punya bom aktif (hasBomb === false)
         *   2. Sudah cukup waktu sejak bom terakhir (3-5 detik acak)
         *   3. Tidak sudah ada bom di kotak ini
         *   4. Tidak sedang dalam zona berbahaya (jangan taruh bom lalu mati)
         */
        if (selectedLevel >= 2) {
            const now = Date.now();
            const cooldownPassed = (now - enemy.lastBombTime) > (3000 + Math.random() * 2000);
            if (!enemy.hasBomb && cooldownPassed && !inDanger &&
                !bombs.some(b => b.x === enemy.x && b.y === enemy.y)) {

                const newBomb = { x: enemy.x, y: enemy.y };
                bombs.push(newBomb);
                enemy.hasBomb = true;
                enemy.fleeSteps = 3; // Paksa lari 3 langkah setelah taruh bom
                enemy.lastBombTime = now;

                setTimeout(() => {
                    explode(newBomb.x, newBomb.y);
                    bombs = bombs.filter(b => b !== newBomb);
                    enemy.hasBomb = false; // Bom meledak → bisa taruh bom lagi
                }, 3000);
            }
        }
    });
    renderGame();
}

/**
 * Mekanik Bom & Ledakan
 */
function placeBomb() {
    // Cek jika sudah ada bom di posisi tersebut
    if (bombs.some(b => b.x === player.x && b.y === player.y)) return;

    const newBomb = { x: player.x, y: player.y };
    bombs.push(newBomb);
    renderGame();

    // Hitung mundur ledakan
    setTimeout(() => {
        explode(newBomb.x, newBomb.y);
        bombs = bombs.filter(b => b !== newBomb);
    }, 3000);
}

/**
 * Logika Deteksi Ledakan
 * Menghitung dampak ledakan pada area tanda tambah (+) dengan radius 2
 */
function explode(bx, by) {
    if (!gameActive) return; // Jangan ledakkan jika game sudah selesai
    
    const explosionCells = [{x: bx, y: by}];
    const directions = [{dx:1, dy:0}, {dx:-1, dy:0}, {dx:0, dy:1}, {dx:0, dy:-1}];
    
    function applyDamage(ex, ey) {
        // Bunuh Musuh → Drop bintang spesial (+150)
        const enemyCountBefore = enemies.length;
        enemies = enemies.filter(enemy => enemy.x !== ex || enemy.y !== ey);
        const killed = enemyCountBefore - enemies.length;
        if (killed > 0) {
            // Taruh bintang spesial di lokasi musuh mati (jika kosong)
            if (map[ey][ex] === TILE_EMPTY) {
                map[ey][ex] = TILE_STAR_SPECIAL;
            }
            // Jadwalkan respawn untuk setiap musuh yang mati
            for (let i = 0; i < killed; i++) {
                scheduleEnemyRespawn();
            }
        }

        // Kenai Pemain
        if (player.x === ex && player.y === ey) {
            takeDamage();
        }
    }
    
    // Kenai posisi tengah (pusat bom)
    applyDamage(bx, by);

    directions.forEach(dir => {
        for (let i = 1; i <= 2; i++) {
            const ex = bx + dir.dx * i;
            const ey = by + dir.dy * i;

            // Pastikan dalam batas grid
            if (ex < 0 || ex >= GRID_COLS || ey < 0 || ey >= GRID_ROWS) break;

            // Cek hambatan permanen (berhenti menembus)
            if (map[ey][ex] === TILE_PERMANENT) break;

            explosionCells.push({x: ex, y: ey});

            // Hancurkan bata → Drop bintang normal (+100)
            if (map[ey][ex] === TILE_BRICK) {
                map[ey][ex] = TILE_STAR_NORMAL;
                applyDamage(ex, ey);
                break; // Ledakan berhenti setelah menghancurkan bata
            }

            // Jika kosong, terapkan damage
            applyDamage(ex, ey);
        }
    });

    renderGame(explosionCells);

    // Hapus visual ledakan setelah 500ms
    setTimeout(() => renderGame(), 500);
}

/**
 * Render Game
 */
function renderGame(explosions = []) {
    gameBoardElement.innerHTML = ''; 

    for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
            const cellElement = document.createElement('div');
            cellElement.classList.add('cell');

            // Layer Peta
            if (map[y][x] === TILE_PERMANENT) {
                cellElement.classList.add('wall-permanent');
            } else if (map[y][x] === TILE_BRICK) {
                cellElement.classList.add('wall-brick');
            } else if (map[y][x] === TILE_STAR_NORMAL) {
                cellElement.classList.add('floor');
                const star = document.createElement('div');
                star.classList.add('star');
                cellElement.appendChild(star);
            } else if (map[y][x] === TILE_STAR_SPECIAL) {
                cellElement.classList.add('floor');
                const star = document.createElement('div');
                star.classList.add('star', 'star-special');
                cellElement.appendChild(star);
            } else {
                cellElement.classList.add('floor');
            }

            // Layer Bom
            if (bombs.some(b => b.x === x && b.y === y)) {
                const bomb = document.createElement('div');
                bomb.classList.add('bomb');
                cellElement.appendChild(bomb);
            }

            // Layer Ledakan
            if (explosions.some(e => e.x === x && e.y === y)) {
                const expl = document.createElement('div');
                expl.classList.add('explosion');
                cellElement.appendChild(expl);
            }

            // Layer Musuh
            if (enemies.some(e => e.x === x && e.y === y)) {
                const enemy = document.createElement('div');
                enemy.classList.add('enemy');
                cellElement.appendChild(enemy);
            }

            // Layer Pemain
            if (x === player.x && y === player.y) {
                const p = document.createElement('div');
                p.classList.add('player'); 
                if (isInvulnerable) p.classList.add('invulnerable');
                cellElement.appendChild(p);
            }

            gameBoardElement.appendChild(cellElement);
        }
    }
}

/**
 * Kontrol Pemain
 */
function movePlayer(dx, dy) {
    if (!gameActive) return;

    const newX = player.x + dx;
    const newY = player.y + dy;

    if (newX < 0 || newX >= GRID_COLS || newY < 0 || newY >= GRID_ROWS) return;

    const tile = map[newY][newX];
    if (tile === TILE_PERMANENT || tile === TILE_BRICK) return;
    
    // Cegah jalan di atas bom
    if (bombs.some(b => b.x === newX && b.y === newY)) return;

    player.x = newX;
    player.y = newY;

    /**
     * Logika Pengambilan Bintang & Penambahan Skor
     */
    const currentTile = map[player.y][player.x];
    if (currentTile === TILE_STAR_NORMAL) {
        const earned = Math.floor(Math.random() * (30 - 10 + 1)) + 10;
        currentScore += earned;
        map[player.y][player.x] = TILE_EMPTY;
        updateUI();
    } else if (currentTile === TILE_STAR_SPECIAL) {
        const earned = Math.floor(Math.random() * (70 - 50 + 1)) + 50;
        currentScore += earned;
        map[player.y][player.x] = TILE_EMPTY;
        updateUI();
    }

    // Cek tabrakan musuh setelah bergerak
    if (enemies.some(e => e.x === player.x && e.y === player.y)) {
        takeDamage();
    }

    renderGame();
}

/**
 * Status Game — Waktu Habis & Game Over
 */
function timesUp() {
    gameActive = false;
    clearInterval(timerInterval);
    clearInterval(enemyInterval);
    clearAllRespawnTimeouts();
    
    saveScore(playerName, currentScore);
    winTimeDisplay.textContent = currentScore;
    winScreen.style.display = 'flex';
}

function gameOver() {
    gameActive = false;
    clearInterval(timerInterval);
    clearInterval(enemyInterval);
    clearAllRespawnTimeouts();
    
    saveScore(playerName, currentScore);
    loseScoreDisplay.textContent = currentScore;
    loseScreen.style.display = 'flex';
}

function clearAllRespawnTimeouts() {
    respawnTimeouts.forEach(id => clearTimeout(id));
    respawnTimeouts = [];
}

function getGameDuration(level) {
    if (level === 1) return 120;
    if (level === 2) return 90;
    return 60;
}

function resetGame() {
    winScreen.style.display = 'none';
    loseScreen.style.display = 'none';
    
    clearAllRespawnTimeouts();
    
    player = { x: 0, y: 0 };
    bombs = [];
    currentScore = 0;
    playerHealth = 3;
    isInvulnerable = false;
    elapsedTime = 0;
    gameDuration = getGameDuration(selectedLevel);
    
    initMap();
    spawnEnemies();
    renderGame();
    updateUI();
    
    gameActive = true;
    startTime = Date.now();
    
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        elapsedTime = Math.floor((Date.now() - startTime) / 1000);
        updateUI();
        
        // Cek apakah waktu sudah habis
        if (elapsedTime >= gameDuration) {
            timesUp();
        }
    }, 1000);

    if (enemyInterval) clearInterval(enemyInterval);
    enemyInterval = setInterval(moveEnemies, 500);
}

function backToMenu() {
    gameActive = false;
    winScreen.style.display = 'none';
    loseScreen.style.display = 'none';
    gameBoardElement.innerHTML = ''; // Bersihkan papan game lama
    
    clearAllRespawnTimeouts();
    if (timerInterval) clearInterval(timerInterval);
    if (enemyInterval) clearInterval(enemyInterval);
    
    welcomeScreen.style.display = 'flex';
    renderLeaderboard();
}

/**
 * Event Listeners
 */
btnStart.addEventListener('click', () => {
    const inputVal = inputNameElement.value.trim();
    if (!inputVal) {
        alert("Masukkan Nama dulu!");
        inputNameElement.focus();
        return;
    }
    
    playerName = inputVal;
    selectedLevel = parseInt(selectLevelElement.value) || 1;
    welcomeScreen.style.display = 'none';
    
    playRandomBGM();
    resetGame();
});

btnPlayAgain.addEventListener('click', resetGame);

btnTryAgain.addEventListener('click', resetGame);

btnMenuWin.addEventListener('click', backToMenu);
btnMenuLose.addEventListener('click', backToMenu);

if (btnMute) {
    btnMute.addEventListener('click', () => {
        isMuted = !isMuted;
        if (currentTrack) {
            currentTrack.muted = isMuted;
        }
        btnMute.textContent = isMuted ? '🔇' : '🔊';
    });
}

window.addEventListener('keydown', (e) => {
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight", " "].indexOf(e.key) > -1) e.preventDefault();
    if (!gameActive) return;

    switch(e.key) {
        case 'ArrowUp': case 'w': case 'W': movePlayer(0, -1); break;
        case 'ArrowDown': case 's': case 'S': movePlayer(0, 1); break;
        case 'ArrowLeft': case 'a': case 'A': movePlayer(-1, 0); break;
        case 'ArrowRight': case 'd': case 'D': movePlayer(1, 0); break;
        case ' ': placeBomb(); break; // Spasi untuk Bom
    }
});

/**
 * Kontrol Virtual Mobile
 */
const btnUp = document.getElementById('btn-up');
const btnDown = document.getElementById('btn-down');
const btnLeft = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');
const btnBomb = document.getElementById('btn-bomb');

function addTouchControl(element, action) {
    if (!element) return;

    const triggerAction = (e) => {
        if (e.cancelable) e.preventDefault(); // Mencegah zoom/scroll saat tap

        // Visual feedback aktif
        element.classList.add('active');
        setTimeout(() => element.classList.remove('active'), 120);

        action();
    };

    // touchstart: respons langsung tanpa delay 300ms
    element.addEventListener('touchstart', triggerAction, { passive: false });

    // mousedown: agar bisa ditest di PC
    element.addEventListener('mousedown', triggerAction);

    // Cegah context menu saat long-press di HP
    element.addEventListener('contextmenu', (e) => e.preventDefault());

    // Cegah scroll saat jari bergerak di atas tombol
    element.addEventListener('touchmove', (e) => {
        if (e.cancelable) e.preventDefault();
    }, { passive: false });
}

// Pasang fungsi pergerakan ke masing-masing tombol
addTouchControl(btnUp, () => movePlayer(0, -1));
addTouchControl(btnDown, () => movePlayer(0, 1));
addTouchControl(btnLeft, () => movePlayer(-1, 0));
addTouchControl(btnRight, () => movePlayer(1, 0));

// Pasang fungsi menaruh bom
addTouchControl(btnBomb, () => placeBomb());

/**
 * Leaderboard — Sistem Skor Tertinggi (v3)
 */
function getLeaderboard() {
    const scores = localStorage.getItem('bomskuy_leaderboard_v3');
    return scores ? JSON.parse(scores) : [];
}

function saveScore(name, score) {
    const scores = getLeaderboard();
    scores.push({ name, score, level: selectedLevel });
    scores.sort((a, b) => b.score - a.score); // Descending: skor tertinggi di atas
    localStorage.setItem('bomskuy_leaderboard_v3', JSON.stringify(scores.slice(0, 5)));
    renderLeaderboard();
}

function renderLeaderboard() {
    const scores = getLeaderboard();
    leaderboardList.innerHTML = scores.length ? "" : "<li>Belum ada rekor</li>";
    scores.forEach(s => {
        const li = document.createElement('li');
        const levelText = s.level ? ` (Lv ${s.level})` : "";
        li.textContent = `${s.name} - ${s.score} pts${levelText}`;
        leaderboardList.appendChild(li);
    });
}

renderLeaderboard();
initMap();
renderGame();
