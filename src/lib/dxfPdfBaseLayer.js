export function hasPdfImportImage(baseLayer) {
  return !!baseLayer?.pdfImport?.imageHref
}

export function getAiRecognitionImageSource(baseLayer) {
  if (!hasPdfImportImage(baseLayer)) return null
  return {
    imageUrl: baseLayer.pdfImport.imageHref,
    source: 'pdf-crop',
  }
}

export function composeDxfPdfBaseLayer({ dxfLayer, pdfLayer, pdfImportData, importPreview }) {
  if (!dxfLayer || dxfLayer.type !== 'dxf') throw new Error('DXF base layer is required')
  if (!pdfLayer || pdfLayer.type !== 'pdf') throw new Error('PDF base layer is required')
  if (!pdfImportData?.crop || !pdfImportData?.imageHref) throw new Error('PDF crop data is required')
  const crop = pdfImportData.crop
  const overlayLines = importPreview?.overlayLines?.length ? importPreview.overlayLines : dxfLayer.previewLines
  const overlayBbox = importPreview?.overlayBbox || {
    minX: 0,
    minY: 0,
    maxX: crop.width,
    maxY: crop.height,
    width: crop.width,
    height: crop.height,
  }

  return {
    ...dxfLayer,
    type: 'dxf',
    importMode: 'dxf-pdf',
    filename: `${dxfLayer.filename} + ${pdfLayer.filename}`,
    width: crop.width,
    height: crop.height,
    bbox: overlayBbox,
    previewLines: overlayLines,
    dxfSource: {
      bbox: dxfLayer.bbox,
      lineCount: dxfLayer.previewLines?.length || dxfLayer.dxfLines?.length || 0,
    },
    pdfFilename: pdfLayer.filename,
    pdfStoragePath: pdfLayer.storagePath,
    pdfPublicUrl: pdfLayer.publicUrl,
    pdfPreviewUrl: pdfLayer.previewUrl,
    pdfPreviewStoragePath: pdfLayer.previewStoragePath,
    pdfPages: pdfLayer.pages || [],
    pdfPageCount: pdfLayer.pageCount || pdfImportData.pageCount || 1,
    pdfImport: {
      crop: pdfImportData.crop,
      imageHref: pdfImportData.imageHref,
      imageStoragePath: pdfImportData.imageStoragePath,
      textItems: pdfImportData.textItems || [],
      pdfColumns: pdfImportData.pdfColumns || [],
      pageCount: pdfImportData.pageCount || pdfLayer.pageCount || 1,
      preview: importPreview ? {
        meta: importPreview.meta || {},
        rooms: importPreview.rooms || [],
        overlayBbox,
      } : null,
    },
  }
}
