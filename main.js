// Aliases
const createEl = document.createElement.bind(document);
const qS = document.querySelector.bind(document);


// Elements
const $fileInput = qS('.file-input');
const $pictureList = qS('.picture-list');
const $pictureCanvas = qS('.picture-canvas');
const $pictureCanvasOverlay = qS('.picture-canvas-overlay');
const $zoomCanvas = qS('.zoom-canvas');
const $xCoord = qS('.x-coord');
const $yCoord = qS('.y-coord');
const $selectedPts = qS('.selected-points');
const $fileContents = qS('.file-contents');
const $bottomSection = qS('.bottom-section');
const $welcomeMessage = qS('.welcome-message');
const $brightnessHandle = qS('.brightness-handle');
const $contrastHandle = qS('.contrast-handle');
const $imageSizeWidth = qS('.image-size-width');
const $imageSizeHeight = qS('.image-size-height');


// Canvas Contexts
const ctx = $pictureCanvas.getContext('2d');
const ctxOverlay = $pictureCanvasOverlay.getContext('2d');
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

        if (!dataObj.hasOwnProperty('skip_dispatch')) {
            this.dispatchToViews();
        }
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

const selectedPtsStore = new Store({selectedPts: []});
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

const currentImgElStore = new Store({$currentImgEl: null});

const currentImgMetaStore = new Store({brightness: 100, contrast: 100});
currentImgMetaStore.setSubscribers([
    updateImageFiltersView
]);

const currentImgSizeStore = new Store({currentImgSize: {width: 0, height: 0}});
currentImgSizeStore.setSubscribers([
    updateImageSizeView
]);

const draggingCtrlStore = new Store({dragging: false, $draggingEl: null, attributeName: null});

// Event Listeners
$fileInput.addEventListener('change', handleFiles, false);
$pictureCanvas.addEventListener('mousemove', handlePictureMouseover);
$pictureCanvas.addEventListener('mouseout', handlePictureMouseout);
$pictureCanvas.addEventListener('click', handlePictureClick);
$pictureList.addEventListener('click', handleThumbnailClick);

$brightnessHandle.addEventListener('mousedown', handleSliderDown);
$contrastHandle.addEventListener('mousedown', handleSliderDown);
document.addEventListener('mousemove', handleSliderMove);
document.addEventListener('mouseup', handleSliderUp);

// Event Handlers
function handleFiles(e) {
    $welcomeMessage.style.display = 'none';
    fileStore.updateData({files: e.target.files});
}

function handlePictureMouseover(e) {
    const target = e.target;

    // get mouse position over canvas element
    // floor in order to handle when browser is zoomed (it can add decimals to pixel values)
    const y = Math.floor(e.pageY - $bottomSection.offsetTop - target.offsetTop + target.parentElement.scrollTop - 1);
    const x = Math.floor(e.pageX - $bottomSection.offsetLeft - target.offsetLeft + target.parentElement.scrollLeft - 1);

    currentPtStore.updateData({currentPt: {x: x, y: y}});
    clearCanvas($zoomCanvas, ctxZoom)

    drawGuidelines(ctxOverlay, {x: x,  y: y});
    drawSelectedPts(ctxOverlay);

    // zoomMethod1(ctxZoom, x, y);
    zoomMethod2(ctx, ctxZoom, x, y);
}

function handlePictureMouseout() {
    clearCanvas($pictureCanvasOverlay, ctxOverlay);
}

function handlePictureClick(e) {
    let existingPts = selectedPtsStore.getData('selectedPts');
    const currentPt = currentPtStore.getData('currentPt');

    existingPts.push(currentPt);
    selectedPtsStore.updateData({selectedPts: existingPts});
}

async function handleThumbnailClick(e) {
    const fileIdx = parseInt(e.target.dataset.fileidx);

    if (fileIdx >= 0) {
        fileStore.updateData({selectedFileIdx: fileIdx});
        selectedPtsStore.updateData({selectedPts: []});

        await readImage(fileStore.getData('files')[fileIdx]);

        $brightnessHandle.style.left = 'initial';
        $contrastHandle.style.left = 'initial';
    }
}

function handleSliderDown(e) {
    draggingCtrlStore.updateData({dragging: true, $draggingEl: e.target, attributeName: e.target.dataset.name});
}

function handleSliderMove(e) {
    const {dragging, $draggingEl, attributeName} = draggingCtrlStore.getData();

    if (dragging && $draggingEl) {
        // set new slider position
        const indicatorWidth = parseInt(getComputedStyle($brightnessHandle).width.replace('px', '')) / 2;
        const sliderWidth = $draggingEl.parentElement.offsetWidth;
        const sliderStartX = $draggingEl.parentElement.offsetLeft;
        const sliderEndX = sliderStartX + $draggingEl.parentElement.offsetWidth;
        const mouseX = e.pageX;

        const indicatorX = e.pageX - sliderStartX - indicatorWidth;
        const leftX = Math.min(Math.max(indicatorX, 0 - indicatorWidth), sliderWidth - indicatorWidth); // limit slider range 0 < x < sliderWidth

        $draggingEl.style.left = leftX + 'px';

        // set new value of brightness/contrast
        // brightness and contrast vary on 0-200 scale with 100 being original/neutral
        const incrementLength = 200 / sliderWidth;
        const percentSet = incrementLength * leftX;

        let newAttrData = {};
        newAttrData[attributeName] = percentSet;
        currentImgMetaStore.updateData(newAttrData);
    }
}

function handleSliderUp(e) {
    const dragging = draggingCtrlStore.getData('dragging');

    if (dragging) {
        draggingCtrlStore.updateData({dragging: false, $draggingEl: null});
    }
}

function handleExplicitPtClick(e) {
    e.preventDefault();

    const selectedPts = selectedPtsStore.getData('selectedPts');
    const x = parseInt(e.target.elements.x.value);
    const y = parseInt(e.target.elements.y.value);

    selectedPts.push({x: x, y: y});
    selectedPtsStore.updateData({selectedPts: selectedPts});
}


// View Updaters
function updateFileListView() {
    const fileData = fileStore.getData();
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

function updateCoordinatesView() {
    const coords = currentPtStore.getData('currentPt');

    $xCoord.innerText = coords.x;
    $yCoord.innerText = coords.y;
}

async function updatePictureCanvasView() {
    const img = currentImgSrcStore.getData('currentImgSrc');

    clearCanvas($pictureCanvas, ctx);
    await drawImageToCanvas(img, $pictureCanvas, ctx);
}

function updateSelectedPtsView() {
    const selectedPts = selectedPtsStore.getData('selectedPts');

    $selectedPts.innerHTML = ''; // clear all pts

    selectedPts.forEach((pt, idx) => {
        const $newPtEl = createPtElement(pt, idx);
        $selectedPts.appendChild($newPtEl);
    });

    clearCanvas($pictureCanvasOverlay, ctxOverlay);
    drawSelectedPts(ctxOverlay);
}

function updateImageFiltersView() {
    const $imgEl = currentImgElStore.getData('$currentImgEl');
    const {brightness, contrast} = currentImgMetaStore.getData();

    ctx.filter = (`brightness(${brightness}%) contrast(${contrast}%)`)
    ctx.drawImage($imgEl, 0, 0);
}

function updateDataFileView() {
    const selectedPts = selectedPtsStore.getData('selectedPts');
    const dataAsString = JSON.stringify(selectedPts, null, 2);
    $fileContents.innerHTML = `<pre class="formatted-data">${dataAsString}</pre>`;
}

function updateSliderViews() {
    const {brightness, contrast} = currentImgMetaStore.getData();

    const sliderPositionBrightness = brightness === 100 ? 'initial' : brightness + 'px';
    const sliderPositionContrast = contrast === 100 ? 'initial' : contrast + 'px';

    $brightnessHandle.style.left = sliderPositionBrightness;
    $contrastHandle.style.left = sliderPositionContrast;
}

function updateImageSizeView() {
    const {width, height} = currentImgSizeStore.getData('currentImgSize');

    $imageSizeHeight.innerHTML = `${height}h`;
    $imageSizeWidth.innerHTML = `${width}w`;


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

        // store this so that filters can be applied without rebuiling the element and reloading the img src
        currentImgElStore.updateData({'$currentImgEl': img});

        img.onload = function() {
            $targetCanvas.width = img.width;
            $targetCanvas.height = img.height;
            $pictureCanvasOverlay.width = img.width;
            $pictureCanvasOverlay.height = img.height;

            currentImgSizeStore.updateData({currentImgSize: {width: img.width, height: img.height}});
            currentImgMetaStore.updateData({brightness: 100, contrast: 100, skip_dispatch: true});

            targetContext.filter = (`brightness(100%) contrast(100%)`);
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

function createPtElement(pt, idx) {
    let newPtEl = createEl('li');

    newPtEl.innerHTML = `
        <div class="selected-pt">
            <span class="selected-pt-x">x: ${pt.x}</span>
            <span class="selected-pt-y">y: ${pt.y}</span>
            <span class="selected-pt-delete" onClick=removeSelectedPt("${idx}")></span>
        </div>
    `

    return newPtEl
}

function removeSelectedPt(ptIdx) {
    const selectedPts = selectedPtsStore.getData('selectedPts');

    selectedPts.splice(ptIdx, 1);
    selectedPtsStore.updateData({selectedPts: selectedPts})
}

function drawSelectedPts(targetCtx) {
    let pts = [];
    const selectedPts = selectedPtsStore.getData('selectedPts');

    targetCtx.beginPath();

    selectedPts.forEach((pt, i) => {
        targetCtx.moveTo(pt.x, pt.y);
        targetCtx.arc(pt.x, pt.y, SELECTED_PT_RADIUS, 0, 2 * Math.PI);
        targetCtx.fillStyle = SELECTED_PT_COLOR;
        targetCtx.fill();
    });
}

function drawGuidelines(targetCtx, points) {
    const CENTER_OFFSET = 5;
    const currentImgSize = currentImgSizeStore.getData('currentImgSize');

    clearCanvas($pictureCanvasOverlay, ctxOverlay);

    targetCtx.beginPath();
    targetCtx.strokeStyle = 'red';
    targetCtx.lineWidth = 1;

    targetCtx.moveTo(points.x - CENTER_OFFSET, points.y);
    targetCtx.lineTo(0, points.y);

    targetCtx.moveTo(points.x + CENTER_OFFSET, points.y);
    targetCtx.lineTo(currentImgSize.width, points.y);

    targetCtx.moveTo(points.x, points.y + CENTER_OFFSET);
    targetCtx.lineTo(points.x, currentImgSize.height);

    targetCtx.moveTo(points.x, points.y - CENTER_OFFSET);
    targetCtx.lineTo(points.x, 0);

    targetCtx.stroke();
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

