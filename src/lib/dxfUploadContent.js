export function buildDxfUploadContent({ preview, rawLines = [], rawBbox, texts = [] }) {
  const hasPreview = preview?.lines?.length > 0 && preview?.bbox
  const previewLines = hasPreview ? preview.lines : rawLines
  const bbox = hasPreview ? preview.bbox : rawBbox

  return {
    dxfLines: previewLines,
    dxfTexts: texts,
    previewLines,
    rawBbox,
    previewMeta: preview?.meta || null,
    width: bbox?.width || 1000,
    height: bbox?.height || 1000,
    bbox: bbox || { minX: 0, minY: 0, maxX: 1000, maxY: 1000, width: 1000, height: 1000 },
  }
}
