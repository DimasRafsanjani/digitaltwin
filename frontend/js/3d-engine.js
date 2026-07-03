import { S, AppState } from './state.js';

let scene, cam, ren, ctrl, box, ambient, sun, fill, ground, rootGroup, plantGroup;

export function initScene() {
    // --- THREE.JS Setup ---
    box = document.getElementById('threejs-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0d12);
    scene.fog = new THREE.Fog(0x0a0d12, 60, 200);

    cam = new THREE.PerspectiveCamera(45, box.clientWidth / box.clientHeight, 0.1, 500);
    cam.position.set(0, 4, 10);

    ren = new THREE.WebGLRenderer({ antialias: true });
    ren.setSize(box.clientWidth, box.clientHeight);
    ren.setPixelRatio(window.devicePixelRatio);
    ren.shadowMap.enabled = true;
    ren.outputEncoding = THREE.sRGBEncoding;
    box.appendChild(ren.domElement);

    ctrl = new THREE.OrbitControls(cam, ren.domElement);
    ctrl.enableDamping = true;
    ctrl.maxPolarAngle = Math.PI / 2;
    ctrl.target.set(0, 2, 0);

    // --- Lighting ---
    ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    scene.add(sun);
    // A subtle fill light from below-left for depth
    fill = new THREE.DirectionalLight(0x88aaff, 0.3);
    fill.position.set(-5, -2, 5);
    scene.add(fill);

    // --- Ground ---
    ground = new THREE.Mesh(
        new THREE.CircleGeometry(3.5, 32),
        new THREE.MeshStandardMaterial({
            color: 0x17110a,
            roughness: 1.0
        })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // --- Root geometry (L-System, shown underground) ---
    const rootGeo = new THREE.CylinderGeometry(0.005, 0.008, 1, 4).translate(0, 0.5, 0);
    rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // --- Plant container ---
    plantGroup = new THREE.Group();
    scene.add(plantGroup);

    // Inisiasi awal status
    console.log('Procedural L-System Rice Plant Generator Active.');
    let deviceStatus = "Menunggu Data...";
    let deviceTimeout;

    function updateDeviceStatus(isOnline) {
        const badge = document.getElementById('stage-display');
        if (!badge) return;

        if (isOnline) {
            deviceStatus = "Alat: Online";
            badge.style.background = "#3cf08d";
            badge.style.color = "#000";
        } else {
            deviceStatus = "Alat: Online";
            badge.style.background = "#ff5252";
            badge.style.color = "#fff";
        }
        const phase = S.age >= 90 ? "Fase Pematangan" : (S.age >= 60 ? "Fase Reproduktif" : "Fase Vegetatif");
        badge.innerText = phase + " | " + deviceStatus;
    }

    updateDeviceStatus(false);

    // --- PROCEDURAL GENERATION: LEAF L-SYSTEM ---

}

function createLeaf(length, width, color, wiltAngle, heightRatio) {
    const leafGroup = new THREE.Group();
    let currentParent = leafGroup;
    const segments = 4;
    const segLen = length / segments;

    const leafMat = new THREE.MeshStandardMaterial({
        color: color,
        side: THREE.DoubleSide,
        roughness: 0.8,
        shadowSide: THREE.DoubleSide
    });

    for (let i = 0; i < segments; i++) {
        const rBottom = width * (1.0 - (i / segments) * 0.85);
        const rTop = width * (1.0 - ((i + 1) / segments) * 0.85);

        let geo;
        if (i < segments - 1) {
            // Ruas awal & tengah menggunakan silinder agar menyambung mulus
            geo = new THREE.CylinderGeometry(rTop, rBottom, segLen, 8);
        } else {
            // Ruas terakhir baru meruncing menggunakan kerucut
            geo = new THREE.ConeGeometry(rBottom, segLen, 8);
        }
        geo.translate(0, segLen / 2, 0);
        geo.rotateX(Math.PI / 2); // Arahkan ke depan (axis lokal Z)

        const mesh = new THREE.Mesh(geo, leafMat);
        mesh.scale.set(1.0, 0.08, 1.0); // Bikin pipih (ketebalan 8% dari lebar)
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const joint = new THREE.Group();
        joint.add(mesh);

        // Bending melengkung alami + wilting
        // Daun padi bagian bawah melengkung lebih berat, daun atas lebih tegak
        const naturalBend = (0.04 + (i * 0.09)) * (1.0 - heightRatio * 0.6);
        const activeWilt = (i === 0) ? wiltAngle * 0.65 : wiltAngle * 0.25;
        joint.rotation.x = naturalBend + activeWilt;

        if (i > 0) {
            joint.position.z = segLen;
        }
        currentParent.add(joint);
        currentParent = joint;
    }
    return leafGroup;
}

// --- PROCEDURAL GENERATION: PANICLE (Grains/Malai) ---
function createPanicle(length, radius, S) {
    const panicleGroup = new THREE.Group();

    let grainCol = new THREE.Color(0x7fa255); // Bulir muda hijau
    if (S.age > 80) {
        grainCol.lerp(new THREE.Color(0xd4ab2a), THREE.MathUtils.clamp((S.age - 80) / 30, 0, 1)); // Bulir matang kuning emas
    }
    if (S.humi > 90) {
        grainCol.lerp(new THREE.Color(0x56412f), 0.4); // Pembusukan karena kelembapan tinggi
    }

    const grainMat = new THREE.MeshStandardMaterial({ color: grainCol, roughness: 0.6 });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x7fa255, roughness: 0.9 });

    const branches = 6;
    const segLen = length / branches;
    let currentParent = panicleGroup;

    for (let i = 0; i < branches; i++) {
        const geo = new THREE.CylinderGeometry(radius * (1 - i / branches), radius * (1.1 - i / branches), segLen, 4);
        geo.translate(0, segLen / 2, 0);

        const mesh = new THREE.Mesh(geo, stemMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const joint = new THREE.Group();
        joint.add(mesh);

        if (i > 0) {
            joint.position.y = segLen;
        }
        // Malai melengkung berat ke bawah (melambangkan berat padi)
        joint.rotation.x = 0.22 + (i * 0.14);

        // Bulir-bulir padi dibuat lebih besar dan lebat
        const grainsPerSeg = 5; // Ditingkatkan dari 3 menjadi 5
        for (let g = 0; g < grainsPerSeg; g++) {
            // Tangkai bulir dibuat sedikit lebih besar
            const grainStemGeo = new THREE.CylinderGeometry(0.003, 0.005, 0.04, 3);
            grainStemGeo.translate(0, 0.02, 0);
            const gStem = new THREE.Mesh(grainStemGeo, stemMat);

            // Bulir padi dibuat 2x lebih besar (radius 0.024) dan lebih lonjong
            const grainGeo = new THREE.SphereGeometry(0.024, 6, 6);
            grainGeo.scale(1.0, 2.2, 1.0); // Bentuk lonjong padi yang jelas
            grainGeo.translate(0, 0.04, 0);
            const gMesh = new THREE.Mesh(grainGeo, grainMat);
            gMesh.castShadow = true;
            gMesh.receiveShadow = true;

            const grainGroup = new THREE.Group();
            grainGroup.add(gStem);
            grainGroup.add(gMesh);

            grainGroup.position.y = (g / grainsPerSeg) * segLen;
            grainGroup.rotation.x = (Math.random() - 0.5) * 1.6;
            grainGroup.rotation.z = (Math.random() - 0.5) * 1.6;
            joint.add(grainGroup);
        }

        currentParent.add(joint);
        currentParent = joint;
    }
    return panicleGroup;
}

// --- PROCEDURAL GENERATION: STALK (Tiller/Anakan) ---
function createTiller(height, baseRadius, color, S, sunPos, leanFactor) {
    const tillerGroup = new THREE.Group();

    // Jumlah ruas bertambah seiring umur
    const segments = Math.floor(THREE.MathUtils.mapLinear(S.age, 1, 60, 2, 5));
    const segLen = height / segments;

    const stalkMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.75 });
    let currentParent = tillerGroup;

    // Batang layu merunduk jika tanah kering
    const stalkWilt = S.moisture < 45 ? THREE.MathUtils.mapLinear(S.moisture, 0, 45, 0.35, 0) : 0.0;

    for (let i = 0; i < segments; i++) {
        const currentRadius = baseRadius * (1.0 - (i / segments) * 0.5);
        const geo = new THREE.CylinderGeometry(currentRadius * 0.8, currentRadius, segLen, 6);
        geo.translate(0, segLen / 2, 0);

        const mesh = new THREE.Mesh(geo, stalkMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const joint = new THREE.Group();
        joint.add(mesh);

        if (i > 0) {
            joint.position.y = segLen;
        }

        // Gabungan pembengkokan natural + kelayuan + phototropism (menuju matahari)
        const leanX = (sunPos.x * leanFactor) * (i / segments);
        const leanZ = (sunPos.z * leanFactor) * (i / segments);

        joint.rotation.x = (i === 0 ? 0.06 : 0.03) + stalkWilt * 0.15 + leanZ;
        joint.rotation.z = leanX;

        // Tambah Daun di setiap ruas batang (distribusi dari bawah ke atas)
        if (i > 0 && i < segments) {
            const ratio = i / segments;
            const leafAngle = (i % 2 === 0) ? Math.PI / 4 : -Math.PI / 4;

            // Daun bawah jauh lebih panjang daripada daun atas
            const leafLen = height * 0.58 * (1.0 - ratio * 0.5);
            // Daun bawah lebih lebar, daun atas lebih ramping
            const leafWidth = Math.max(currentRadius * (8.5 - ratio * 4.5), 0.038);
            const activeWilt = S.moisture < 45 ? THREE.MathUtils.mapLinear(S.moisture, 0, 45, 1.3, 0) : 0.0;

            // 1. Tambah Pelepah Daun (Leaf Sheath) untuk membungkus batang
            const sheathGeo = new THREE.CylinderGeometry(currentRadius * 1.15, currentRadius * 1.25, segLen * 0.28, 8);
            const sheathMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.8 });
            const sheath = new THREE.Mesh(sheathGeo, sheathMat);
            sheath.castShadow = true;
            sheath.receiveShadow = true;
            sheath.position.y = segLen;
            sheath.rotation.y = leafAngle;
            joint.add(sheath);

            // 2. Tambah Helai Daun (Leaf Blade)
            const leaf = createLeaf(leafLen, leafWidth, color, activeWilt, ratio);
            leaf.position.y = segLen;
            leaf.rotation.y = leafAngle + (Math.random() - 0.5) * 0.25;

            // Daun bawah lebih condong keluar (-0.45), daun atas lebih tegak lurus ke atas (-0.80)
            leaf.rotation.x = -0.45 - ratio * 0.35;

            joint.add(leaf);
        }

        currentParent.add(joint);
        currentParent = joint;
    }

    // Tambah Malai di ujung atas setelah umur 60 hari
    if (S.age > 60) {
        const panicle = createPanicle(height * 0.28, baseRadius * 0.75, S);
        panicle.position.y = segLen;
        currentParent.add(panicle);
    }

    return tillerGroup;
}

// --- BUILD PLANT MAIN CONTROL ---
export function buildPlant() {
    plantGroup.clear();
    rootGroup.clear();

    // Tentukan Fase Pertumbuhan & Gabung dengan Status Alat
    let phase = S.age >= 90 ? "Fase Pematangan" : (S.age >= 60 ? "Fase Reproduktif" : "Fase Vegetatif");
    document.getElementById('stage-display').innerText = phase + " | " + AppState.deviceStatus;

    // === 1. ARAS / KECEPATAN TUMBUH (USIA & SUHU) ===
    let tempFactor = 1.0 - Math.abs(S.atemp - 27.5) / 25;
    tempFactor = THREE.MathUtils.clamp(tempFactor, 0.4, 1.0);

    // Jumlah anakan diatur oleh TDS (Nutrisi)
    let maxTillersTDS = Math.floor(THREE.MathUtils.mapLinear(S.tds, 0, 1500, 1, 10));
    maxTillersTDS = THREE.MathUtils.clamp(maxTillersTDS, 1, 12);

    let tillers = Math.floor(THREE.MathUtils.mapLinear(S.age * tempFactor, 1, 60, 1, maxTillersTDS));
    if (S.age > 60) tillers = Math.min(maxTillersTDS, Math.floor(maxTillersTDS * tempFactor + 2));

    // Tinggi Padi
    let growthScale = THREE.MathUtils.mapLinear(S.age * tempFactor, 1, 80, 0.15, 1.0);
    growthScale = THREE.MathUtils.clamp(growthScale, 0.15, 1.0);

    // === 2. ETIOLASI & PHOTOTROPISM (CAHAYA) ===
    let yStretch = 1.0;
    let xzStretch = 1.0;
    if (S.light < 5000) {
        yStretch = THREE.MathUtils.mapLinear(S.light, 0, 5000, 1.8, 1.0); // Meninggi (Etiolasi)
        xzStretch = THREE.MathUtils.mapLinear(S.light, 0, 5000, 0.55, 1.0); // Menipis
    }

    let sunPos = new THREE.Vector3(10, 20, 10).normalize();
    let leanFactor = THREE.MathUtils.mapLinear(S.light, 0, 50000, 0, 0.18); // Kecondongan ke arah matahari

    // === 3. KESEHATAN & KLOROSIS (TDS, MOISTURE, SUHU) ===
    let healthScore = (S.moisture / 100) * (Math.min(S.tds, 1200) / 1200) * tempFactor;

    const healthyGreen = new THREE.Color(0x2f642a);
    const chlorotic = new THREE.Color(0xbebe47);
    const straw = new THREE.Color(0x9a8a42);
    const burnt = new THREE.Color(0x403225);

    let plantCol = healthyGreen.clone();
    if (healthScore < 0.7) plantCol.lerp(chlorotic, 1 - (healthScore / 0.7));
    if (S.light > 80000) plantCol.lerp(burnt, (S.light - 80000) / 40000); // Terbakar cahaya berlebih
    if (S.age > 85) plantCol.lerp(straw, THREE.MathUtils.clamp((S.age - 85) / 35, 0, 1)); // Layu menguning panen

    // === 4. GENERATE RUMPUN PADI ---
    const finalHeight = growthScale * yStretch * 3.6;
    const tdsThickness = THREE.MathUtils.mapLinear(S.tds, 0, 2000, 0.55, 1.25);
    const finalRadius = 0.02 * xzStretch * tdsThickness;

    for (let t = 0; t < tillers; t++) {
        const angle = (t / tillers) * Math.PI * 2;
        // Rumpun tumbuh sangat rapat di pangkal tanah (seolah tumbuh dari 1 titik benih)
        const spreadRadius = (tillers === 1) ? 0 : 0.012 + (t * 0.006);

        // Generate anakan prosedural
        const tiller = createTiller(finalHeight, finalRadius, plantCol, S, sunPos, leanFactor);
        tiller.position.set(Math.sin(angle) * spreadRadius, 0, Math.cos(angle) * spreadRadius);

        // yaw (Y) memutarkan anakan, pitch (X) mencondongkan anakan keluar secara radial
        tiller.rotation.y = angle + (Math.random() - 0.5) * 0.15;
        // Semakin luar anakan, semakin condong keluar agar membentuk rumpun mekar
        const tiltAngle = (tillers === 1) ? 0.03 : 0.15 + (t * 0.02);
        tiller.rotation.x = tiltAngle;

        plantGroup.add(tiller);
    }

    if (S.roots) buildRoots();
    // --- ENHANCED Root System (Branching L-System - Akar Serabut Organik & Meliuk) ---
    function buildRoots() {
        let rootCol = new THREE.Color(0xf5f0e1);
        if (S.wtemp > 35 || S.wtemp < 18) rootCol.set(0x4a3a2a); // Stress browning akibat suhu air ekstrem
        let mat = new THREE.MeshBasicMaterial({ color: rootCol, transparent: true, opacity: 0.7 });

        // Jumlah serabut per anakan (tiller) dipengaruhi oleh umur dan kelembapan tanah
        let moistureIncentive = S.moisture < 30 ? 1.4 : 1.0;
        let rootsPerTiller = Math.floor(THREE.MathUtils.mapLinear(S.age, 1, 120, 3, 5) * moistureIncentive);
        rootsPerTiller = THREE.MathUtils.clamp(rootsPerTiller, 2, 7);

        let branchingProb = 1.0 - Math.abs(S.wtemp - 24) / 20;
        branchingProb = THREE.MathUtils.clamp(branchingProb, 0.2, 0.95);

        // Akar tumbuh menyatu dari pangkal masing-masing anakan (tiller)
        for (let t = 0; t < tillers; t++) {
            const angle = (t / tillers) * Math.PI * 2;
            const spreadRadius = (tillers === 1) ? 0 : 0.012 + (t * 0.006);
            const startPos = new THREE.Vector3(Math.sin(angle) * spreadRadius, 0, Math.cos(angle) * spreadRadius);

            for (let r = 0; r < rootsPerTiller; r++) {
                // Menyebar penuh 360 derajat melingkari pangkal anakan secara simetris
                let rootAngle = (r / rootsPerTiller) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;

                // Vektor arah awal: melebar keluar ke segala arah
                let initDir = new THREE.Vector3(
                    Math.sin(rootAngle) * 0.85,
                    -0.35 - Math.random() * 0.15,
                    Math.cos(rootAngle) * 0.85
                ).normalize();

                createRootSegment(startPos, initDir, 0, mat, S, branchingProb);
            }
        }
    }

    function createRootSegment(start, dir, depth, mat, S, branchProb) {
        if (depth > 6) return; // Bertumbuh hingga 7 ruas pendek untuk kelayuan meliuk

        // Panjang ruas pendek agar kurva lengkungannya halus
        let rootLen = THREE.MathUtils.mapLinear(S.age, 1, 120, 0.08, 0.24) * (1.0 - depth * 0.08);
        rootLen = Math.max(rootLen, 0.04);

        // Ketebalan akar menipis secara bertahap
        let rBottom = 0.010 * (1.0 - depth * 0.11);
        let rTop = 0.010 * (1.0 - (depth + 1) * 0.11);
        rBottom = Math.max(rBottom, 0.002);
        rTop = Math.max(rTop, 0.001);

        const geo = new THREE.CylinderGeometry(rTop, rBottom, rootLen, 6);
        geo.translate(0, rootLen / 2, 0);

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(start);
        mesh.lookAt(start.clone().add(dir));
        mesh.rotateX(Math.PI / 2);
        rootGroup.add(mesh);

        let end = start.clone().add(dir.clone().multiplyScalar(rootLen));

        // Logika Gravitasi & Wiggle (Akar meliuk-liuk ditarik ke bawah)
        // Belokkan arah secara bertahap menuju bawah (0, -1, 0)
        let gravityPull = 0.22; // Menarik akar melengkung ke bawah
        let nextDir = dir.clone().lerp(new THREE.Vector3(0, -1, 0), gravityPull);

        // Efek Wiggle (meliuk-liuk acak)
        nextDir.x += (Math.random() - 0.5) * 0.22;
        nextDir.y += (Math.random() - 0.5) * 0.08;
        nextDir.z += (Math.random() - 0.5) * 0.22;
        nextDir.normalize();

        // 1. Tumbuhkan kelanjutan akar utama
        createRootSegment(end, nextDir, depth + 1, mat, S, branchProb);

        // 2. Tumbuhkan rambut akar/percabangan lateral secara acak
        if (Math.random() < branchProb * 0.45 && depth < 4) {
            // Arah cabang lateral tegak lurus keluar secara acak
            let lateralDir = new THREE.Vector3(nextDir.z, -0.2, -nextDir.x).normalize();
            if (Math.random() > 0.5) lateralDir.negate();
            lateralDir.add(new THREE.Vector3((Math.random() - 0.5) * 0.3, -0.1, (Math.random() - 0.5) * 0.3)).normalize();

            // Panggil secara rekursif dengan depth + 2 agar cabang samping lebih pendek dan tipis
            createRootSegment(end, lateralDir, depth + 2, mat, S, branchProb);
        }
    }
}

// --- Animation ---
export function animate() {
    requestAnimationFrame(animate);

    // Wind sway
    let windSpeed = THREE.MathUtils.mapLinear(S.light, 0, 100000, 0.4, 1.2);
    let t = Date.now() * 0.001 * windSpeed;
    plantGroup.rotation.z = Math.sin(t) * 0.01;
    plantGroup.rotation.x = Math.cos(t * 1.3) * 0.005;

    // Ambient light intensity from Light sensor
    let ambientIntensity = THREE.MathUtils.mapLinear(S.light, 0, 100000, 0.2, 0.7);
    ambient.intensity = ambientIntensity;

    ctrl.update();
    ren.render(scene, cam);
}


export function toggleSoil(isVisible) { if (ground) ground.visible = isVisible; }
export function resetCamera() { if (cam && ctrl) { cam.position.set(0, 4, 10); ctrl.target.set(0, 2, 0); } }
export function handleResize() { if (cam && ren && box) { cam.aspect = box.clientWidth / box.clientHeight; cam.updateProjectionMatrix(); ren.setSize(box.clientWidth, box.clientHeight); } }
