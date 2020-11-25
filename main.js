// Aliases
const createEl = document.createElement.bind(document);
const qS = document.querySelector.bind(document);


// Elements
const $fileInput = qS('.file-input');
const $pictureList = qS('.picture-list');
const $pictureCanvas = qS('.picture-canvas');
const $zoomCanvas = qS('.zoom-canvas');
const $xCoord = qS('.x-coord');
const $yCoord = qS('.y-coord');
const $selectedPts = qS('.selected-points');
const $fileContents = qS('.file-contents');


// Canvas Contexts
const ctx = $pictureCanvas.getContext('2d');
const ctxZoom = $zoomCanvas.getContext('2d');


// Constants
const ZOOM = 18;
const ZOOM_HORIZONTAL = 11;
const ZOOM_VERTICAL = 11;
const SELECTED_PT_COLOR = 'rgba(40,240,40,1)';
const SELECTED_PT_RADIUS= 4;


// Intial Setup
$zoomCanvas.width = ZOOM_HORIZONTAL * ZOOM + ZOOM_HORIZONTAL;
$zoomCanvas.height = ZOOM_VERTICAL * ZOOM + ZOOM_VERTICAL;

class Store {
    constructor(data = {}) {
        this.data = data;
        this.viewUpdaters = [];
    }

    updateData(dataObj) {
        for (let key in dataObj) {
            if (this.data.hasOwnProperty(key)) {
                this.data[key] = dataObj[key];
            }
        }

        this.dispatchToViews();
    }

    getData(key) {
        if (key) {
            return this.data[key]
        } else {
            return this.data
        }
    }

    setSubscribers(subs = []) {
        subs.forEach(sub => {
            this.viewUpdaters.push(sub);
        })
    }

    dispatchToViews() {
        this.viewUpdaters.forEach(sub => {
            sub(this.data);
        })
    }
}

// Data Stores and View Updaters
const fileStore = new Store({files: [], selectedFileIdx: -1});
fileStore.setSubscribers([
    updateFileListView
]);

const selectedPtsStore = new Store({selectedPts: {}});
selectedPtsStore.setSubscribers([
    updateSelectedPtsView,
    updateDataFileView,
    updateSaveFileLinkView
]);

const currentPtStore = new Store({currentPt: {x: 0, y: 0}});
currentPtStore.setSubscribers([
    updateCoordinatesView
]);

const currentImgSrcStore = new Store({currentImgSrc: null});
currentImgSrcStore.setSubscribers([
    updatePictureCanvasView
]);


// Event Listeners
$fileInput.addEventListener('change', handleFiles, false);
$pictureCanvas.addEventListener('mousemove', handlePictureMouseover);
$pictureCanvas.addEventListener('click', handlePictureClick);
$pictureList.addEventListener('click', handleThumbnailClick);


// Event Handlers
function handleFiles(e) {
    fileStore.updateData({files: e.target.files});
}

function handlePictureMouseover(e) {
    const target = e.target;

    // get mouse position over canvas element
    // floor in order to handle when browser is zoomed (it can add decimals to pixel values)
    const y = Math.floor(e.pageY - target.offsetTop + target.parentElement.scrollTop - 1);
    const x = Math.floor(e.pageX - target.offsetLeft + target.parentElement.scrollLeft - 1);

    currentPtStore.updateData({currentPt: {x: x, y: y}});
    clearCanvas($zoomCanvas, ctxZoom)

    // zoomMethod1(ctxZoom, x, y);
    zoomMethod2(ctx, ctxZoom, x, y);
}

function handlePictureClick(e) {
    let existingPts = selectedPtsStore.getData('selectedPts');
    const currentPt = currentPtStore.getData('currentPt');

    // index sets requirement that points be unique
    existingPts[currentPt.x.toString() + currentPt.y.toString()] = [currentPt.x, currentPt.y]
    selectedPtsStore.updateData({selectedPts: existingPts});
}

async function handleThumbnailClick(e) {
    const fileIdx = parseInt(e.target.dataset.fileidx);

    if (fileIdx >= 0) {
        fileStore.updateData({selectedFileIdx: fileIdx});
        selectedPtsStore.updateData({selectedPts: {}});
        await readImage(fileStore.getData('files')[fileIdx]);
    }
}


// View Updaters
function updateFileListView(fileData) {
    const files = fileData.files;
    const selectedFile = fileData.selectedFileIdx;

    $pictureList.innerHTML = '';

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const selectedClass = selectedFile === i ? 'selected' : '';
        const $imgDiv = createEl('li');

        if (selectedClass) {
            $imgDiv.classList.add(selectedClass);
        }
    
        $imgDiv.innerHTML = `<div class="selected-indicator"></div><span data-fileidx=${i}>${file.name}</span>`
        $pictureList.appendChild($imgDiv);
    }
}

function updateCoordinatesView(coords) {
    $xCoord.innerText = coords.currentPt.x;
    $yCoord.innerText = coords.currentPt.y;
}

async function updatePictureCanvasView(imgData) {
    const img = imgData.currentImgSrc;

    clearCanvas($pictureCanvas, ctx);
    await drawImageToCanvas(img, $pictureCanvas, ctx);
}

async function updateSelectedPtsView(selectedPtsData) {
    const selectedPts = selectedPtsData.selectedPts;

    $selectedPts.innerHTML = ''; // clear all pts

    for (let pt in selectedPts) {
        let newPtEl = createPtElement(pt);
        $selectedPts.appendChild(newPtEl)
    }

    await drawImageToCanvas(currentImgSrcStore.getData('currentImgSrc'), $pictureCanvas, ctx);
    drawSelectedPts(ctx);
}

function updateDataFileView(data) {
    const dataAsString = JSON.stringify(data.selectedPts, null, 2);
    $fileContents.innerHTML = `<pre class="formatted-data">${dataAsString}</pre>`;
}


// Functions
function readImage(file) {
    return new Promise((resolve, reject) => {
        if (file.type.startsWith('image/')){    
            const reader = new FileReader();
            console.log('reading file', file)
            reader.onload = e => {
                currentImgSrcStore.updateData({currentImgSrc: e.target.result});
                resolve(e.target.result);
            }
            reader.readAsDataURL(file);
        }
        else {
            reject(new Error('File is not an image'))
        }
    })
}

async function drawImageToCanvas(imgSrc, $targetCanvas, targetContext) {
    return new Promise((resolve, reject) => {
        var img = new Image();
        
        img.crossOrigin = 'anonymous';
        img.src = imgSrc;

        img.onload = function() {
            $targetCanvas.width = img.width;
            $targetCanvas.height = img.height;
            targetContext.drawImage(img, 0, 0);
            img.style.display = 'none';
            resolve();
        };
    });
}

// This zoom method automatically draws the zoomed in image data (without grid spaces)
function zoomMethod1(ctx, x, y) {
    ctx.imageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;

    ctx.drawImage($pictureCanvas,
        Math.min(Math.max(0, x - ZOOM_HORIZONTAL), $pictureCanvas.width - ZOOM_HORIZONTAL * 2),
        Math.min(Math.max(0, y - ZOOM_VERTICAL), $pictureCanvas.height - ZOOM_VERTICAL * 2),
        ZOOM_HORIZONTAL * 2, ZOOM_VERTICAL * 2,
        0, 0,
        ZOOM * ZOOM_HORIZONTAL, ZOOM * ZOOM_VERTICAL);
};

// This zoom method explicity draws the pixels in question (with grid spaces)
function zoomMethod2(ctx, ctxZoom, x, y) {
    // for centering the zoomed pixels
    const zoomOffsetWidth = Math.floor(ZOOM_HORIZONTAL / 2);
    const zoomOffsetHeight = Math.floor(ZOOM_VERTICAL / 2); 

    const pixels = ctx.getImageData(x - zoomOffsetWidth, y - zoomOffsetHeight, ZOOM_HORIZONTAL, ZOOM_VERTICAL);
    const pixelData = pixels.data;

    for (let i = 0; i < ZOOM_VERTICAL; i++) {
        for (let j = 0; j < ZOOM_HORIZONTAL; j++) {
            const batchIdx = (ZOOM_HORIZONTAL * 4 * i) + (4 * j);
            const pixelColor = `rgba(${pixelData[batchIdx]}, ${pixelData[batchIdx + 1]}, ${pixelData[batchIdx + 2]}, ${pixelData[batchIdx + 3] / 255})`;
            
            ctxZoom.fillStyle = pixelColor;
            ctxZoom.fillRect(j + j * ZOOM, i + i * ZOOM, ZOOM, ZOOM); // j+j and i+i create the spaces in the pixel grid
        }
    }

    // highlight center pixel (this is the pixel the user is currently hovering)
    ctxZoom.strokeStyle = '#f0c';
    ctxZoom.rect(zoomOffsetWidth * (ZOOM + 1), zoomOffsetHeight * (ZOOM + 1), ZOOM + 1, ZOOM + 1);
    ctxZoom.stroke();
}

function createPtElement(pt) {
    let newPtEl = createEl('li');
    const selectedPts = selectedPtsStore.getData('selectedPts');

    newPtEl.innerHTML = `
        <div class="selected-pt">
            <span class="selected-pt-x">x: ${selectedPts[pt][0]}</span>
            <span class="selected-pt-y">y: ${selectedPts[pt][1]}</span>
            <span class="selected-pt-delete" onClick=removeSelectedPt("${pt}")></span>
        </div>
    `

    return newPtEl
}

function removeSelectedPt(pt) {
    const selectedPts = selectedPtsStore.getData('selectedPts');

    delete selectedPts[pt];
    selectedPtsStore.updateData({selectedPts: selectedPts})
}

function drawSelectedPts(targetCtx) {
    let pts = [];
    const selectedPts = selectedPtsStore.getData('selectedPts');

    targetCtx.beginPath();

    for (let pt in selectedPts) {
        pts[pts.length] = selectedPts[pt]
    }

    pts.forEach((pt, i) => {
        targetCtx.moveTo(pt[0], pt[1]);
        targetCtx.arc(pt[0], pt[1], SELECTED_PT_RADIUS, 0, 2 * Math.PI);
        targetCtx.fillStyle = SELECTED_PT_COLOR;
        targetCtx.fill();
    });
}

function clearCanvas($targetCanvas, targetContext) {
    targetContext.clearRect(0, 0, $targetCanvas.width, $targetCanvas.height);
}


function updateSaveFileLinkView(data) {
    const filesData = fileStore.getData();
    const selectedFilename = filesData.files[filesData.selectedFileIdx].name;
    const newFilename = (selectedFilename.substr(0, selectedFilename.lastIndexOf('.')) || selectedFilename) + '.json';
    const dataAsString = JSON.stringify(data.selectedPts, null, 2);
    
    const properties = {type: 'text/plain'}; // Specify the file mime-type.
    const file = new File([dataAsString], newFilename, properties);
    const url = URL.createObjectURL(file);

    qS('.save-to-file').href = url;
}

