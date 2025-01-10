const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  win.loadFile('index.html')
}

// Ajout de la vérification/création du dossier scrims
function ensureScrimsDirectory() {
  const scrimsPath = path.join(app.getAppPath(), 'scrims');
  if (!fs.existsSync(scrimsPath)) {
    fs.mkdirSync(scrimsPath);
  }
  return scrimsPath;
}

ipcMain.handle('get-app-path', () => {
  return app.getAppPath();
});

ipcMain.handle('list-scrims', async () => {
  const scrimsPath = ensureScrimsDirectory();
  try {
    const files = await fs.promises.readdir(scrimsPath);
    return files;
  } catch (error) {
    console.error('Error reading scrims directory:', error);
    throw error;
  }
});

app.whenReady().then(() => {
  ensureScrimsDirectory(); // Créer le dossier au démarrage
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
