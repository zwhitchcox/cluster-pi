const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const electron = require('electron');
const fetch = require('node-fetch')
const isDev = require('electron-is-dev');
const storage = require('electron-json-storage')
const { runSSH } = require("./run-ssh.js")
const { interactiveSSH } = require('./interactive-ssh')
const { downloadImg, unzipImg } = require('./img')
const { dialog } = require('electron')

const {ipcMain} = electron
const app = electron.app;
// const { scanner } = require('./lib/scanner')
const BrowserWindow = electron.BrowserWindow;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: isDev ? 900 + 600 : 900,
    height: 680,
    webPreferences: {
      nodeIntegration: true,
      preload: __dirname + '/preload.js'
    }
  });
  mainWindow.loadURL(isDev ? 'http://localhost:3000' : `file://${path.join(__dirname, '../build/index.html')}`);
  if (isDev) {
    // Open the DevTools.
    //BrowserWindow.addDevToolsExtension('<location to your react chrome extension>');
    mainWindow.webContents.openDevTools();
  }
  mainWindow.on('closed', () => mainWindow = null);
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});


// Node Scanner

const CHECK_INTERVAL = 3 * 1000 // check for new/deleted nodes every 3 seconds
let nodes = {}
let _prevNodes = {};

var Client = require('node-ssdp').Client
  , client = new Client();

const getNodeInfo = url => fetch(`${url}/node-info`)
  .then(r => {
    if (r.status > 399) {
      return Promise.reject(`Something went wrong getting the status for ${url}`)
    }
    return r.json()
  })
  .then(nodeInfo => {
    nodes[url] = {
    ...nodeInfo,
    apiResponded: true,
  }})
  .catch(() => {
    nodes[url] = {
      apiResponded: false,
    }
  })

client.on('response', (headers, statusCode, rinfo) => {
  if (headers["ST"] && headers["ST"] == "cruster:node") {
    const url = headers["LOCATION"]
    getNodeInfo(url)
  }
})

const {stringify, parse} = JSON
const copy = obj => parse(stringify(obj))
const compare = (obj1, obj2) => stringify(obj1) === stringify(obj2)
const check = () => {
  client.search('cruster:node')
  if (!compare(_prevNodes, nodes)) {
    mainWindow.send('nodes', _prevNodes = copy(nodes))
  }
  nodes = {}
  setTimeout(check, CHECK_INTERVAL)
}
check()

ipcMain.on('send-nodes', (event, arg) => {
  mainWindow.send('nodes', nodes)
})

// SSH Connection
let key;
try {
key = fs.readFileSync(path.join(os.homedir(), ".ssh", "id_rsa")).toString()
} catch (e) {
  console.log("no key")
}
ipcMain.on('get-key', (event) => {
  event.returnValue = key
})

// SSH Run
ipcMain.on('run-cmd', (event, msg) => {
  const {cmd, host, key, id} = msg
  runSSH({
    id,
    cmd,
    host,
    key,
    mainWindow,
  })
})

// SSH Interactive
ipcMain.on('create-interactive', (_, msg) => {
  const {host, key, id} = msg
  interactiveSSH({
    id,
    host,
    key,
    mainWindow,
  })
})


/*
 *
 * Image
 *
*/

// Download

ipcMain.on('download-image', (event, {downloadID, force}) => {
  downloadImg({
    mainWindow,
    downloadID,
    force,
    downloadDir,
  })
})

let downloadDir;
 ;(async () => {
  let _downloadDir = path.resolve(os.homedir(), "Downloads")
  if (await fs.exists(_downloadDir)) {
    return downloadDir = path.resolve(_downloadDir, "cruster")
  }
  downloadDir = path.resolve(os.homedir(), "cruster")
})()

ipcMain.on('get-download-dir', (event) => {
  event.returnValue = downloadDir
})

ipcMain.on('change-download-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  if (!result.canceled) {
    downloadDir = result.filePaths[0]
    storage.set("download-dir", downloadDir)
  }
  mainWindow.send("download-dir-changed", {downloadDir})
})

// unzip

ipcMain.on('unzip-image', async (event, {unzipID, force}) => {
  const outputPath = downloadDir
  const zipPath = path.resolve(downloadDir, "node.zip")
  if (!force && await fs.exists(path.resolve(outputPath, "node.img"))) {
    return
  }
  unzipImg({
    zipPath,
    outputPath,
    unzipID,
    mainWindow,
  })
})

// output

let outputDir;
;(async function getOutputDir() {
  let _outputDir = storage.get("output-dir");
  if (_outputDir) {
    return outputDir = _outputDir
  }


  if (await fs.exists(_outputDir = path.resolve(os.homedir(), "Desktop"))) {
    return outputDir = path.resolve(_outputDir, "cruster")
  }


  if (await fs.exists(_outputDir = path.resolve(os.homedir(), "desktop"))) {
    return outputDir = path.resolve(_outputDir, "cruster")
  }

  outputDir = path.resolved(os.homedir(), "cruster")
})()

ipcMain.on('get-output-dir', (event) => {
  event.returnValue = outputDir
})

ipcMain.on('change-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  if (!result.canceled) {
    outputDir = result.filePaths[0]
    storage.set("output-dir", outputDir)
  }
  mainWindow.send("output-dir-changed", {outputDir})
})