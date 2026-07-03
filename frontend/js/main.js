import { checkAuth } from './api.js';
import { initScene, animate, handleResize } from './3d-engine.js';
import { initUI } from './ui.js';

window.addEventListener('DOMContentLoaded', () => {
    initScene();
    initUI();
    checkAuth();
    animate();
});

window.addEventListener('resize', handleResize);
