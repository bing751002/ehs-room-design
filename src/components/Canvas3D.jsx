import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid, Sky } from '@react-three/drei'
import { useMemo } from 'react'
import { usePlanStore } from '../store/planStore.js'
import {
  spaceVertices, allRenderableWalls, polygonCenter, polygonArea, openingEnds
} from '../lib/constraints.js'

/**
 * 3D 預覽 — Sprint 3 升級:
 *  - 空間 → 多邊形地板 (Shape + ExtrudeGeometry)
 *  - 牆 → 沿著空間邊垂直拉高的盒子,共用邊只算一次
 *  - 門 → 在牆上挖洞 (用 CSG 太貴,先用「兩段牆 + 門框」近似)
 *  - 窗 → 牆上嵌透明玻璃 (近似)
 *  - 光照:Environment HDR + directional
 *  - 單位:1 Three.js unit = 1 公尺 (座標 / 100)
 */
const CM_TO_M = 0.01

/**
 * @param {Object} props
 *   - view: 'perspective' (預設斜視角) | 'topdown' (俯瞰,給 2D 編輯內嵌預覽)
 *   - mini: true 為小型嵌入版,關閉控制器、減負載
 *   - showRoof: 是否顯示天花 (預設 false 才看得到內部)
 */
export default function Canvas3D({ view = 'perspective', mini = false, showRoof = false }) {
  const plan = usePlanStore(s => s.plan)
  const bounds = plan.bounds || { w: 4000, h: 3000 }
  const center = [bounds.w * CM_TO_M / 2, 0, bounds.h * CM_TO_M / 2]
  // 俯瞰相機在正上方
  const camPos = view === 'topdown'
    ? [center[0], Math.max(bounds.w, bounds.h) * CM_TO_M * 0.8, center[2] + 0.01]
    : [center[0] + 15, 18, center[2] + 22]
  const fov = view === 'topdown' ? 35 : 50

  return (
    <div className="h-full w-full bg-gradient-to-b from-sky-100 to-slate-50">
      <Canvas shadows camera={{ position: camPos, fov }}
              dpr={mini ? 1 : [1, 2]}>
        {!mini && <Sky sunPosition={[100, 50, 100]} />}
        <ambientLight intensity={0.55} />
        <directionalLight position={[20, 30, 10]} intensity={1.3} castShadow
                          shadow-mapSize-width={mini ? 512 : 1024}
                          shadow-mapSize-height={mini ? 512 : 1024} />
        <hemisphereLight intensity={0.4} groundColor="#cccccc" />
        <Grid args={[200, 200]} cellSize={1} sectionSize={5}
              cellThickness={0.3} sectionThickness={0.6}
              cellColor="#e2e8f0" sectionColor="#94a3b8"
              infiniteGrid={false} position={[center[0], 0, center[2]]} />

        <FloorPlate bounds={bounds} />
        <ColumnsLayer plan={plan} />
        <SpacesLayer plan={plan} />
        <WallsLayer3D plan={plan} />
        <FurnitureLayer plan={plan} />
        <LegacyRoomsLayer plan={plan} />

        {!mini && (
          <OrbitControls target={center}
                         enableRotate={view !== 'topdown'}
                         maxPolarAngle={view === 'topdown' ? 0.1 : Math.PI / 2.1} />
        )}
      </Canvas>
    </div>
  )
}

// 空間類型 → 地板顏色 (近似不同材質)
const SPACE_FLOOR_COLORS = {
  office:   '#d6c4a1',  // 木紋色 (淺)
  meeting:  '#c5b89a',
  pantry:   '#dcd1c0',
  gym:      '#3f3f46',  // 深灰膠地
  sauna:    '#7c5a3a',  // 深木
  shower:   '#a8c5d9',  // 灰藍磁磚
  locker:   '#bcaa8c',
  lounge:   '#c9b08f',
  restroom: '#d4d4d8',
  corridor: '#e7e5e4',  // 淺米色磁磚
  custom:   '#d6d3d1'
}

// 樓層底盤
function FloorPlate({ bounds }) {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[bounds.w * CM_TO_M, bounds.h * CM_TO_M]} />
      <meshStandardMaterial color="#f1f5f9" />
    </mesh>
  )
}

// 結構柱
function ColumnsLayer({ plan }) {
  return (<>
    {(plan.structuralColumns || []).map((c, i) => {
      const w = c.w * CM_TO_M, d = c.h * CM_TO_M, h = 3
      const cx = (c.x + c.w/2) * CM_TO_M, cz = (c.y + c.h/2) * CM_TO_M
      return (
        <mesh key={i} position={[cx, h/2, cz]} castShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
      )
    })}
  </>)
}

// 空間地板:多邊形 shape extrude 一點點高度當地板
function SpacesLayer({ plan }) {
  return (<>
    {(plan.spaces || []).map(sp => <SpaceFloor key={sp.id} space={sp} />)}
  </>)
}

function SpaceFloor({ space }) {
  const vs = spaceVertices(space)
  const geom = useMemo(() => {
    if (vs.length < 3) return null
    const shape = new THREE.Shape()
    shape.moveTo(vs[0].x * CM_TO_M, vs[0].y * CM_TO_M)
    for (let i = 1; i < vs.length; i++) {
      shape.lineTo(vs[i].x * CM_TO_M, vs[i].y * CM_TO_M)
    }
    shape.closePath()
    return new THREE.ShapeGeometry(shape)
  }, [JSON.stringify(vs)])
  if (!geom) return null
  // 依空間類型挑材質色 (近似不同地材)
  const floorColor = SPACE_FLOOR_COLORS[space.type] || space.color || '#d6d3d1'
  return (
    <mesh geometry={geom} rotation-x={Math.PI / 2} position={[0, 0.005, 0]} receiveShadow>
      <meshStandardMaterial color={floorColor} roughness={0.7} metalness={0.05} />
    </mesh>
  )
}

// 牆:以線段為中心,用 BoxGeometry 拉高
function WallsLayer3D({ plan }) {
  // 為避免共用邊重複畫,先去重 (兩條相反方向的線段視為同一條)
  const walls = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const w of allRenderableWalls(plan)) {
      // 正規化:小座標在前
      const a = `${Math.min(w.x1, w.x2)},${Math.min(w.y1, w.y2)}`
      const b = `${Math.max(w.x1, w.x2)},${Math.max(w.y1, w.y2)}`
      const key = `${a}-${b}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(w)
    }
    return out
  }, [JSON.stringify(plan.walls || []), JSON.stringify(plan.spaces || [])])

  // 為每面牆找關聯的門/窗 (依 wallId)
  const openingsByWallId = useMemo(() => {
    const map = {}
    for (const d of (plan.doors || [])) {
      if (!map[d.wallId]) map[d.wallId] = { doors: [], windows: [] }
      map[d.wallId].doors.push(d)
    }
    for (const w of (plan.windows || [])) {
      if (!map[w.wallId]) map[w.wallId] = { doors: [], windows: [] }
      map[w.wallId].windows.push(w)
    }
    return map
  }, [JSON.stringify(plan.doors || []), JSON.stringify(plan.windows || [])])

  return (<>
    {walls.map((w, i) => <WallSegment3D key={w.id || i} wall={w}
                                        openings={openingsByWallId[w.id]} />)}
  </>)
}

function WallSegment3D({ wall, openings }) {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1
  const len = Math.sqrt(dx * dx + dy * dy) * CM_TO_M
  if (len === 0) return null
  const angle = Math.atan2(dy, dx)  // X 軸到 (dx,dy) 的角度
  const thickness = (wall.thickness ?? 12) * CM_TO_M
  const height = 2.8  // 預設樓高 280cm
  const cx = (wall.x1 + wall.x2) / 2 * CM_TO_M
  const cz = (wall.y1 + wall.y2) / 2 * CM_TO_M
  // 牆面塗料色 (溫暖米白,接近酷家樂風格)
  const color = wall.kind === 'exterior' ? '#e8e1d4' : '#f5efe4'

  // 計算每個開口 (門/窗) 沿牆的 [t1, t2] 範圍
  const holes = []
  for (const d of (openings?.doors || [])) {
    const halfW = d.width / 2 / (len * 100)
    holes.push({ t1: Math.max(0, d.t - halfW), t2: Math.min(1, d.t + halfW), kind: 'door', y: [0, 2.1] })
  }
  for (const w of (openings?.windows || [])) {
    const halfW = w.width / 2 / (len * 100)
    const sill = (w.sillHeight ?? 90) / 100
    holes.push({ t1: Math.max(0, w.t - halfW), t2: Math.min(1, w.t + halfW), kind: 'window', y: [sill, sill + 1.2] })
  }
  // 把整面牆切成多段 (沿 t 軸切),每段再依高度切 (門上方還是有牆)
  // 為簡化:門口 = 中段牆只到地面(沒牆);窗口 = 上半 + 下半保留
  const segments = []
  let cursor = 0
  const sortedHoles = [...holes].sort((a, b) => a.t1 - b.t1)
  for (const h of sortedHoles) {
    if (h.t1 > cursor) segments.push({ t1: cursor, t2: h.t1, type: 'full' })
    if (h.kind === 'door') {
      // 門上方仍有牆 (門高 2.1, 樓高 2.8 → 上面 0.7m)
      segments.push({ t1: h.t1, t2: h.t2, type: 'lintel', yBottom: h.y[1], yTop: height })
    } else if (h.kind === 'window') {
      // 窗下方有牆 (sill 以下),窗上方有牆 (sill+1.2 以上)
      segments.push({ t1: h.t1, t2: h.t2, type: 'sill', yBottom: 0, yTop: h.y[0] })
      segments.push({ t1: h.t1, t2: h.t2, type: 'lintel', yBottom: h.y[1], yTop: height })
      segments.push({ t1: h.t1, t2: h.t2, type: 'glass', yBottom: h.y[0], yTop: h.y[1] })
    }
    cursor = Math.max(cursor, h.t2)
  }
  if (cursor < 1) segments.push({ t1: cursor, t2: 1, type: 'full' })

  return (
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
      {segments.map((s, i) => {
        const segLen = (s.t2 - s.t1) * len
        if (segLen <= 0) return null
        const segCx = (s.t1 + s.t2) / 2 * len - len / 2
        if (s.type === 'full') {
          return (
            <mesh key={i} position={[segCx, height/2, 0]} castShadow receiveShadow>
              <boxGeometry args={[segLen, height, thickness]} />
              <meshStandardMaterial color={color} roughness={0.85} metalness={0} />
            </mesh>
          )
        }
        if (s.type === 'lintel' || s.type === 'sill') {
          const h = s.yTop - s.yBottom
          return (
            <mesh key={i} position={[segCx, s.yBottom + h/2, 0]} castShadow>
              <boxGeometry args={[segLen, h, thickness]} />
              <meshStandardMaterial color={color} roughness={0.85} metalness={0} />
            </mesh>
          )
        }
        if (s.type === 'glass') {
          const h = s.yTop - s.yBottom
          return (
            <mesh key={i} position={[segCx, s.yBottom + h/2, 0]}>
              <boxGeometry args={[segLen, h, thickness * 0.3]} />
              <meshStandardMaterial color="#bae6fd" opacity={0.4} transparent />
            </mesh>
          )
        }
      })}
    </group>
  )
}

// 家具
function FurnitureLayer({ plan }) {
  return (<>
    {(plan.furniture || []).map(f => {
      const w = f.w * CM_TO_M, d = f.h * CM_TO_M
      const h = (f.height ?? 80) * CM_TO_M
      const cx = (f.x + f.w/2) * CM_TO_M, cz = (f.y + f.h/2) * CM_TO_M
      return (
        <mesh key={f.id} position={[cx, h/2, cz]}
              rotation-y={(f.rot ?? 0) * Math.PI / 180} castShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={f.color ?? '#64748b'} />
        </mesh>
      )
    })}
  </>)
}

// Legacy 房間 (還沒升級成 spaces 的舊資料)
function LegacyRoomsLayer({ plan }) {
  // 如果已經有 spaces,就不畫舊 rooms,避免重疊
  if ((plan.spaces || []).length > 0) return null
  return (<>
    {(plan.rooms || []).map(r => {
      const w = r.w * CM_TO_M, h = r.h * CM_TO_M
      const height = (r.height ?? 280) * CM_TO_M
      const wallT = 0.1
      const cx = (r.x + r.w/2) * CM_TO_M, cz = (r.y + r.h/2) * CM_TO_M
      return (
        <group key={r.id} position={[cx, 0, cz]}>
          <mesh position={[0, 0.001, 0]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial color={r.color ?? '#e2e8f0'} />
          </mesh>
          {[
            { p: [0, height/2,  h/2], s: [w, height, wallT] },
            { p: [0, height/2, -h/2], s: [w, height, wallT] },
            { p: [ w/2, height/2, 0], s: [wallT, height, h] },
            { p: [-w/2, height/2, 0], s: [wallT, height, h] }
          ].map((wall, i) => (
            <mesh key={i} position={wall.p}>
              <boxGeometry args={wall.s} />
              <meshStandardMaterial color="#cbd5e1" transparent opacity={0.5} />
            </mesh>
          ))}
        </group>
      )
    })}
  </>)
}
