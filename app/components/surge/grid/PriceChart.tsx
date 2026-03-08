
import { useRef, useEffect } from 'react'
import type { PricePoint } from '../../../lib/surge/types'

interface PriceChartProps {
  priceHistory: PricePoint[]
  currentPrice: number
  height: number
  numRows: number
  basePrice: number
  bucketSize: number
}

const LINE_COLOR = '#3C8AFF'       // base cerulean
const GRID_COLOR = '#32353D40'     // gray-80 with alpha
const DOT_COLOR = '#3C8AFF60'     // cerulean dots
const BG_COLOR = '#0A0B0D'        // base black

export default function PriceChart({
  priceHistory,
  currentPrice,
  height,
  numRows,
  basePrice,
  bucketSize,
}: PriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const w = container.clientWidth
    const h = height

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // Clear
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, w, h)

    // ─── Use the grid's Y-axis so chart aligns with price labels ───
    const gridTop = basePrice + 5 * bucketSize
    const gridRange = numRows * bucketSize || 0.001
    const rowHeight = h / numRows

    // Price → Y: same coordinate system as the grid rows & PriceAxis
    const priceToY = (p: number) => ((gridTop - p) / gridRange) * h

    const visible = priceHistory.slice(-120)

    // ─── Draw horizontal grid lines (aligned with grid rows) ───
    ctx.setLineDash([2, 4])
    for (let i = 0; i <= numRows; i++) {
      const y = i * rowHeight
      ctx.strokeStyle = GRID_COLOR
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()

      const dotSpacing = 60
      for (let x = dotSpacing; x < w; x += dotSpacing) {
        ctx.fillStyle = DOT_COLOR
        ctx.beginPath()
        ctx.arc(x, y, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Draw vertical grid lines + dots
    const numVertLines = Math.floor(w / 60)
    for (let i = 1; i <= numVertLines; i++) {
      const x = i * 60
      ctx.strokeStyle = GRID_COLOR
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()

      for (let j = 0; j <= numRows; j++) {
        const y = j * rowHeight
        ctx.fillStyle = DOT_COLOR
        ctx.beginPath()
        ctx.arc(x, y, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.setLineDash([])

    // ─── Draw price line (allow drawing beyond canvas — it clips naturally) ───
    if (visible.length > 1) {
      ctx.save()

      // Map prices to grid Y-axis (may go above or below canvas — that's correct)
      const pts = visible.map((pt, i) => ({
        x: (i / (visible.length - 1)) * w,
        y: priceToY(pt.value),
      }))

      // Catmull-Rom spline
      const buildCurve = (path: Path2D) => {
        path.moveTo(pts[0].x, pts[0].y)
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[Math.max(0, i - 1)]
          const p1 = pts[i]
          const p2 = pts[i + 1]
          const p3 = pts[Math.min(pts.length - 1, i + 2)]
          const cp1x = p1.x + (p2.x - p0.x) / 6
          const cp1y = p1.y + (p2.y - p0.y) / 6
          const cp2x = p2.x - (p3.x - p1.x) / 6
          const cp2y = p2.y - (p3.y - p1.y) / 6
          path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
        }
      }

      // Stroke the line
      const curvePath = new Path2D()
      buildCurve(curvePath)
      ctx.strokeStyle = LINE_COLOR
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke(curvePath)

      // Gradient fill under the curve (clip to canvas)
      ctx.beginPath()
      ctx.rect(0, 0, w, h)
      ctx.clip()

      const fillPath = new Path2D()
      buildCurve(fillPath)
      fillPath.lineTo(w, h)
      fillPath.lineTo(0, h)
      fillPath.closePath()
      const last = pts[pts.length - 1]
      const gradient = ctx.createLinearGradient(0, Math.min(last.y - 40, 0), 0, h)
      gradient.addColorStop(0, 'rgba(0, 0, 255, 0.20)')
      gradient.addColorStop(1, 'rgba(0, 0, 255, 0.01)')
      ctx.fillStyle = gradient
      ctx.fill(fillPath)

      // Endpoint dot — clamp to visible area so it's always visible at the edge
      const dotY = Math.max(4, Math.min(h - 4, last.y))
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(last.x, dotY, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = LINE_COLOR
      ctx.beginPath()
      ctx.arc(last.x, dotY, 2.5, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
    }
  }, [priceHistory.length, currentPrice, height, numRows, basePrice, bucketSize])

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  )
}
