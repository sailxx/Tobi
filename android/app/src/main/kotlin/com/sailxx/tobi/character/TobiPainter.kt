package com.sailxx.tobi.character

import android.graphics.Typeface
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.LinearGradientShader
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.PaintingStyle
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.RadialGradientShader
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import com.sailxx.tobi.character.outfit.ComposeGfx
import com.sailxx.tobi.character.outfit.Ctx2D
import com.sailxx.tobi.character.outfit.Outfit
import com.sailxx.tobi.character.outfit.OutfitState
import com.sailxx.tobi.character.outfit.PUMPKIN_BODY
import com.sailxx.tobi.character.outfit.Css
import com.sailxx.tobi.character.outfit.drawOutfitBehind
import com.sailxx.tobi.character.outfit.drawOutfitFront
import com.sailxx.tobi.character.outfit.makeHead
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * Compose Canvas port of TobiEngine.draw() in windows/src/tobi/engine.ts.
 * Draws hands, body, blush, eyes, mouth, badge, particles and the outfits (tobi/outfit, checked against the PC's drawing).
 */
object TobiPainter {
    private val INK = Color(18, 14, 24)
    private val MINI_INK = Color(16, 19, 26)

    private fun Rgb.color(a: Double = 1.0) =
        Color(r.toFloat().coerceIn(0f, 1f), g.toFloat().coerceIn(0f, 1f), b.toFloat().coerceIn(0f, 1f), a.toFloat().coerceIn(0f, 1f))

    private fun cssColor(s: String): Color = Css.parse(s).let { Color((it.r / 255).toFloat(), (it.g / 255).toFloat(), (it.b / 255).toFloat(), it.a.toFloat()) }

    private fun fillPaint(c: Color) = Paint().apply { color = c; isAntiAlias = true }
    private fun strokePaint(c: Color, w: Float) = Paint().apply {
        color = c; isAntiAlias = true; style = PaintingStyle.Stroke; strokeWidth = w; strokeCap = StrokeCap.Round
    }

    fun bodyPath(e: TobiEngine, rx: Double, ry: Double, r: Double): Path {
        val pts = TobiGeometry.bodyPoints(rx, ry, r, e.morph)
        return Path().apply {
            pts.forEachIndexed { i, p -> if (i == 0) moveTo(p.x.toFloat(), p.y.toFloat()) else lineTo(p.x.toFloat(), p.y.toFloat()) }
            close()
        }
    }

    /** Draws Tobi centred in this DrawScope. `nowSec` drives spirals, wave and badge pulses. */
    fun DrawScope.drawTobi(e: TobiEngine, nowSec: Double) {
        val w = size.width.toDouble()
        val h = size.height.toDouble()
        val r = w * 0.3
        val rx = r * 1.0
        val ry = r * 0.96
        val cx = w / 2 + e.ox * r
        val cy = h / 2 + e.particleOverhang / 2 + e.oy * r + r * 0.06

        drawIntoCanvas { c ->
            // With an outfit on, a roll turns the whole character, hat included, as one piece.
            c.save()
            if (e.rigidRoll && abs(e.roll) > 0.001) {
                c.translate(cx.toFloat(), cy.toFloat())
                c.rotate((e.roll * 180 / PI).toFloat())
                c.translate(-cx.toFloat(), -cy.toFloat())
            }
            drawHandsBehind(c, e, nowSec, r, rx, ry, cx, cy)

            c.save()
            c.translate(cx.toFloat(), cy.toFloat())
            if (e.tilt != 0.0) c.rotate((e.tilt * 180 / PI).toFloat())
            c.scale(e.sx.toFloat(), e.sy.toFloat())

            val dressed = !e.isMini && e.outfit != Outfit.NONE
            val head = if (dressed) makeHead(r, e.yaw, e.pitch, e.physDx, e.physDy) else null
            val outfitState = OutfitState(e.outfitPresence, e.morph)
            val outfitCtx = if (head != null) Ctx2D(ComposeGfx(c, Rect(Offset(-w.toFloat(), -h.toFloat()), Offset(w.toFloat(), h.toFloat())))) else null
            if (head != null && outfitCtx != null) drawOutfitBehind(outfitCtx, e.outfit, head, outfitState)

            if (head == null) drawHeadphonesBand(c, e, r, rx, ry)
            val body = bodyPath(e, rx, ry, r)
            drawBody(c, e, body, r, rx, ry)

            val blushVal = max(e.blush, e.tint * 0.5) * (1 - e.morph)
            if (blushVal > 0.01) {
                c.save()
                c.clipPath(body)
                val yOffset = sin(e.yaw) * rx * 0.8
                val p = fillPaint(Color(255, 120, 150, (255 * 0.5 * blushVal).toInt().coerceIn(0, 255)))
                for (sd in intArrayOf(-1, 1)) {
                    c.drawOval(
                        Rect(
                            (sd * rx * 0.55 + yOffset - r * 0.17).toFloat(), (ry * 0.2 - r * 0.1).toFloat(),
                            (sd * rx * 0.55 + yOffset + r * 0.17).toFloat(), (ry * 0.2 + r * 0.1).toFloat(),
                        ), p,
                    )
                }
                c.restore()
            }

            drawEyes(c, e, nowSec, body, r, rx, ry)
            if (e.morph > 0.05) drawMouth(c, e, body, r)
            if (head == null) drawHeadphonesCups(c, e, nowSec, r, rx, ry)

            if (head != null && outfitCtx != null) drawOutfitFront(outfitCtx, e.outfit, head, outfitState)
            c.restore()
            c.restore()

            val badge = e.badge
            if (badge != null && e.badgeS > 0.01 && e.morph < 0.25) drawBadge(c, e, nowSec, badge, r, cx, cy)
            drawParticles(c, e, r, cx, cy)
        }
    }

    private fun drawBody(c: Canvas, e: TobiEngine, body: Path, r: Double, rx: Double, ry: Double) {
        val bodyColor = e.bodyColor
        if (bodyColor != null) {
            c.drawPath(body, fillPaint(bodyColor.color()))
        } else {
            val p = Paint().apply {
                isAntiAlias = true
                shader = LinearGradientShader(
                    Offset((rx * 0.7).toFloat(), (-ry * 0.85).toFloat()), Offset((-rx * 0.8).toFloat(), (ry * 0.9).toFloat()),
                    listOf(TobiConst.BASE_TOP.color(), TobiConst.BASE_BOTTOM.color()),
                )
            }
            c.drawPath(body, p)
        }

        // The pumpkin's orange comes and goes with the outfit; a flat-coloured body only gets the shading while it is a pumpkin.
        val pumpkin = if (e.isMini || e.outfit != Outfit.PUMPKIN) 0.0 else min(1.0, e.outfitPresence * 2.5) * (1 - e.morph)
        var tail = 1f
        if (pumpkin > 0.001) {
            val pg = Paint().apply {
                isAntiAlias = true
                alpha = pumpkin.toFloat().coerceIn(0f, 1f)
                shader = LinearGradientShader(
                    Offset((rx * 0.7).toFloat(), (-ry * 0.85).toFloat()), Offset((-rx * 0.8).toFloat(), (ry * 0.9).toFloat()),
                    listOf(cssColor(PUMPKIN_BODY.first), cssColor(PUMPKIN_BODY.second)),
                )
            }
            c.drawPath(body, pg)
            if (bodyColor != null) tail = pumpkin.toFloat().coerceIn(0f, 1f)
        }

        val effectiveTint = e.tint * (1 - e.morph)
        if (effectiveTint > 0.01) {
            val tg = Paint().apply {
                isAntiAlias = true
                alpha = tail
                shader = LinearGradientShader(
                    Offset(0f, ry.toFloat()), Offset(0f, (-ry).toFloat()),
                    listOf(e.col.color(0.72 * effectiveTint), e.col.color(0.0)),
                )
            }
            c.drawPath(body, tg)
        }

        // Shade: transparent until 0.6 of the 0.15R..1.25R ramp, then black 20%.
        val outer = r * 1.25
        val shadeStart = ((r * 0.15 + 0.6 * (outer - r * 0.15)) / outer).toFloat()
        val sh = Paint().apply {
            isAntiAlias = true
            alpha = tail
            shader = RadialGradientShader(
                Offset.Zero, outer.toFloat(),
                listOf(Color(0, 0, 0, 0), Color(0, 0, 0, 0), Color(0, 0, 0, 51)),
                listOf(0f, shadeStart, 1f),
            )
        }
        c.drawPath(body, sh)

        val hc = Offset((rx * 0.34).toFloat(), (-ry * 0.46).toFloat())
        val hl = Paint().apply {
            isAntiAlias = true
            alpha = tail
            shader = RadialGradientShader(hc, (r * 0.42).toFloat(), listOf(Color(255, 255, 255, 140), Color(255, 255, 255, 0)))
        }
        c.drawPath(body, hl)
    }

    private fun drawEyes(c: Canvas, e: TobiEngine, nowSec: Double, body: Path, r: Double, rx: Double, ry: Double) {
        var shape = e.eyeOverride ?: e.cfg.eye
        if (e.morph > 0.5) {
            if (e.isChewing) shape = EyeShape.HAPPY
            else if (e.slotHTarget > 0.05 || e.slotH > 0.1) shape = EyeShape.CUP
        }
        c.save()
        c.clipPath(body)
        val ink = if (e.isMini) MINI_INK else INK

        for (sd in intArrayOf(-1, 1)) {
            val eyeYaw = sd * TobiConst.EYE_SP + e.yaw
            // Rolling with an outfit on, the whole body turns: the eyes must not roll again.
            var eyePitch = TobiConst.EYE_P + e.pitch + (if (e.rigidRoll) 0.0 else e.roll)
            eyePitch = (((eyePitch + PI) % (PI * 2)) + PI * 2) % (PI * 2) - PI
            val cp = cos(eyePitch)
            if (cos(eyeYaw) * cp <= 0.04) continue

            val ex = sin(eyeYaw) * cp * rx
            val ey = -sin(eyePitch) * ry + (if (e.morph > 0) ry * 0.14 * e.morph else 0.0)
            val fx = lerpD(max(0.18, cos(eyeYaw)), 1.0, e.morph * 0.7)
            val fy = lerpD(max(0.18, cp), 1.0, e.morph * 0.7)
            val mult = if (e.isMini) 1.9 else 1.0
            val ew = r * TobiConst.EYE_W * e.es * mult
            val eh = r * TobiConst.EYE_H * e.es * mult

            c.save()
            c.translate(ex.toFloat(), ey.toFloat())
            c.scale(fx.toFloat(), fy.toFloat())
            drawEyeShape(c, e, nowSec, shape, ew, eh, sd, ink)
            c.restore()
        }
        if (!e.isMini && e.morph < 0.3 && (shape == EyeShape.PILL || shape == EyeShape.WIDE || shape == EyeShape.HAPPY || shape == EyeShape.DOT)) {
            drawSmile(c, e, r, rx, ry)
        }
        c.restore()
    }

    /** The white highlight of a glossy eye. */
    private fun eyeShine(c: Canvas, e: TobiEngine, w: Double, h: Double) {
        if (e.isMini || h < w * 0.5) return
        c.drawCircle(Offset((w * 0.14).toFloat(), (-h * 0.2).toFloat()), (w * 0.17).toFloat(), fillPaint(Color(255, 255, 255, 242)))
    }

    /** The little open smile under the eyes. */
    private fun drawSmile(c: Canvas, e: TobiEngine, r: Double, rx: Double, ry: Double) {
        val face = cos(e.yaw)
        if (face < 0.25) return
        val mx = sin(e.yaw) * rx * 0.95
        val my = ry * 0.34 - sin(e.pitch) * ry * 0.5
        val w = (r * 0.2 * (0.5 + 0.5 * face)).toFloat()
        val h = (r * 0.15).toFloat()
        c.save()
        c.translate(mx.toFloat(), my.toFloat())
        val mouth = Path().apply {
            moveTo(-w, -h * 0.25f)
            quadraticBezierTo(0f, -h * 0.55f, w, -h * 0.3f)
            quadraticBezierTo(w * 0.55f, h * 1.25f, -w * 0.2f, h * 0.85f)
            quadraticBezierTo(-w * 0.85f, h * 0.45f, -w, -h * 0.25f)
            close()
        }
        c.drawPath(mouth, fillPaint(Color(48, 12, 24)))
        c.clipPath(mouth)
        c.drawOval(Rect(-w * 0.6f, h * 0.38f, w * 0.5f, h * 1.18f), fillPaint(Color(190, 52, 66)))
        c.restore()
    }

    /** The headphones' colours (top, bottom, base): blue, taking on the state's colour while Tobi is busy. */
    private fun phoneColors(e: TobiEngine): Triple<Color, Color, Rgb> {
        if (e.tint <= 0.05) return Triple(Color(46, 168, 255), Color(8, 92, 232), TobiConst.PHONE)
        val k = min(0.85, e.tint)
        val base = TobiConst.PHONE.mix(e.col, k)
        return Triple(base.mix(Rgb(1.0, 1.0, 1.0), 0.25).color(), base.mix(Rgb(0.0, 0.0, 0.0), 0.2).color(), base)
    }

    /** The band over his head, behind the body. */
    private fun drawHeadphonesBand(c: Canvas, e: TobiEngine, r: Double, rx: Double, ry: Double) {
        if (r <= 6) return
        val fade = 1 - min(1.0, e.morph / 0.5)
        if (fade <= 0.01) return
        val (top, bottom, _) = phoneColors(e)
        val shift = sin(e.yaw) * rx * 0.2 + e.physDx * r * 0.1
        val p = Paint().apply {
            isAntiAlias = true; style = PaintingStyle.Stroke; strokeCap = StrokeCap.Round
            strokeWidth = max(1.5, r * 0.17).toFloat(); alpha = fade.toFloat()
            shader = LinearGradientShader(Offset(0f, (-ry * 1.3).toFloat()), Offset(0f, 0f), listOf(top, bottom))
        }
        val cy = -ry * 0.06
        val path = Path().apply {
            arcTo(
                Rect((shift - rx * 1.1).toFloat(), (cy - ry * 1.12).toFloat(), (shift + rx * 1.1).toFloat(), (cy + ry * 1.12).toFloat()),
                (PI * 1.1 * 180 / PI).toFloat(), ((PI * 1.9 - PI * 1.1) * 180 / PI).toFloat(), true,
            )
        }
        c.drawPath(path, p)
    }

    /** The two ear cups, on the body's sides; they glow while he works. */
    private fun drawHeadphonesCups(c: Canvas, e: TobiEngine, nowSec: Double, r: Double, rx: Double, ry: Double) {
        if (r <= 6) return
        val fade = 1 - min(1.0, e.morph / 0.5)
        if (fade <= 0.01) return
        val (top, bottom, base) = phoneColors(e)
        val busy = e.state == BotState.WORKING || e.state == BotState.THINKING || e.state == BotState.SEARCHING
        val pulse = if (busy) 0.5 + 0.5 * sin(nowSec * 6) else 0.0
        val shift = sin(e.yaw) * rx * 0.28
        for (sd in intArrayOf(-1, 1)) {
            val squeeze = 1 - 0.45 * max(0.0, sd * sin(e.yaw))
            val w = r * 0.15 * squeeze
            val h = r * 0.6
            c.save()
            c.translate((sd * rx * 0.98 + shift).toFloat(), (ry * 0.1).toFloat())
            if (busy) {
                val gr = (h * (0.55 + 0.35 * pulse)).toFloat()
                val glow = Paint().apply {
                    isAntiAlias = true
                    shader = RadialGradientShader(Offset.Zero, gr, listOf(base.color(0.45), base.color(0.0)))
                }
                c.drawCircle(Offset.Zero, gr, glow)
            }
            val g = Paint().apply {
                isAntiAlias = true; alpha = fade.toFloat()
                shader = LinearGradientShader(Offset((-w).toFloat(), (-h / 2).toFloat()), Offset(w.toFloat(), (h / 2).toFloat()), listOf(top, bottom))
            }
            roundRect(c, -w, -h / 2, w * 2, h, min(w, h / 2), g)
            c.restore()
        }
    }

    private fun roundRect(c: Canvas, x: Double, y: Double, w: Double, h: Double, rad: Double, p: Paint) {
        val rr = max(0.0, min(rad, min(w / 2, h / 2))).toFloat()
        c.drawRoundRect(x.toFloat(), y.toFloat(), (x + w).toFloat(), (y + h).toFloat(), rr, rr, p)
    }

    private fun arcStroke(c: Canvas, cx: Double, cy: Double, rad: Double, startRad: Double, endRad: Double, p: Paint) {
        val path = Path().apply {
            arcTo(
                Rect((cx - rad).toFloat(), (cy - rad).toFloat(), (cx + rad).toFloat(), (cy + rad).toFloat()),
                (startRad * 180 / PI).toFloat(), ((endRad - startRad) * 180 / PI).toFloat(), true,
            )
        }
        c.drawPath(path, p)
    }

    private fun heartPath(s: Double) = Path().apply {
        val f = s.toFloat()
        moveTo(0f, f * 0.38f)
        cubicTo(-f * 1.05f, -f * 0.15f, -f * 0.5f, -f * 0.95f, 0f, -f * 0.38f)
        cubicTo(f * 0.5f, -f * 0.95f, f * 1.05f, -f * 0.15f, 0f, f * 0.38f)
        close()
    }

    private fun starPath(ro: Double, ri: Double) = Path().apply {
        for (i in 0 until 10) {
            val rad = if (i % 2 == 1) ri else ro
            val a = -PI / 2 + i * PI / 5
            val px = (cos(a) * rad).toFloat()
            val py = (sin(a) * rad).toFloat()
            if (i == 0) moveTo(px, py) else lineTo(px, py)
        }
        close()
    }

    private fun drawEyeShape(c: Canvas, e: TobiEngine, nowSec: Double, shape: EyeShape, w: Double, h: Double, sd: Int, ink: Color) {
        val fill = fillPaint(ink)
        when (shape) {
            EyeShape.WIDE -> drawEyeShape(c, e, nowSec, EyeShape.PILL, w * 1.16, h * 1.12, sd, ink)
            EyeShape.PILL -> {
                val hh = max(h * e.open, w * 0.3)
                roundRect(c, -w / 2, -hh / 2, w, hh, min(w / 2, hh / 2), fill)
                eyeShine(c, e, w, hh)
            }
            EyeShape.DOT -> {
                c.drawCircle(Offset.Zero, (w * 0.45).toFloat(), fill)
                eyeShine(c, e, w, w * 0.9)
            }
            EyeShape.LINE -> {
                c.save()
                c.rotate((-sd * 0.2 * 180 / PI).toFloat())
                roundRect(c, -w * 0.78, -w * 0.21, w * 1.56, w * 0.42, w * 0.21, fill)
                c.restore()
            }
            EyeShape.FLAT -> roundRect(c, -w * 0.72, -w * 0.2, w * 1.44, w * 0.4, w * 0.2, fill)
            EyeShape.HAPPY -> arcStroke(c, 0.0, h * 0.18, w * 0.82, PI * 1.12, PI * 1.88, strokePaint(ink, (w * 0.5).toFloat()))
            EyeShape.CLOSED -> arcStroke(c, 0.0, -h * 0.08, w * 0.78, PI * 0.15, PI * 0.85, strokePaint(ink, (w * 0.36).toFloat()))
            EyeShape.SPIRAL -> {
                val path = Path()
                var a = 0.0
                var first = true
                while (a < 4.4 * PI) {
                    val rad = w * 0.06 + a * w * 0.058
                    val aa = a + nowSec * 9 * sd
                    val px = (cos(aa) * rad).toFloat()
                    val py = (sin(aa) * rad).toFloat()
                    if (first) { path.moveTo(px, py); first = false } else path.lineTo(px, py)
                    a += 0.2
                }
                c.drawPath(path, strokePaint(ink, (w * 0.22).toFloat()))
            }
            EyeShape.HEART -> c.drawPath(heartPath(w * 1.2), fillPaint(Color(0xFF, 0x4D, 0x6D)))
            EyeShape.STAR -> {
                c.save()
                c.rotate((nowSec * 1.5 * sd * 180 / PI).toFloat())
                c.drawPath(starPath(w * 1.05, w * 0.46), fillPaint(Color(0xF7, 0xB3, 0x2B)))
                c.restore()
            }
            EyeShape.TIRED -> {
                roundRect(c, -w / 2, -h * 0.02, w, h * 0.38, w / 2, fill)
                roundRect(c, -w * 0.62, -h * 0.1, w * 1.24, w * 0.22, w * 0.11, fill)
            }
            EyeShape.WINK -> if (sd < 0) {
                val hh = max(h * e.open, w * 0.3)
                roundRect(c, -w / 2, -hh / 2, w, hh, min(w / 2, hh / 2), fill)
            } else {
                arcStroke(c, 0.0, h * 0.18, w * 0.82, PI * 1.12, PI * 1.88, strokePaint(ink, (w * 0.5).toFloat()))
            }
            EyeShape.CUP -> {
                // Flat top, rounded bottom corners (U shape), used while the box is open.
                val hh = max(h * e.open, w * 0.3)
                val cr = min(w / 2, hh / 2)
                val path = Path().apply {
                    moveTo((-w / 2).toFloat(), (-hh / 2).toFloat())
                    lineTo((w / 2).toFloat(), (-hh / 2).toFloat())
                    lineTo((w / 2).toFloat(), (hh / 2 - cr).toFloat())
                    quadraticBezierTo((w / 2).toFloat(), (hh / 2).toFloat(), (w / 2 - cr).toFloat(), (hh / 2).toFloat())
                    lineTo((-w / 2 + cr).toFloat(), (hh / 2).toFloat())
                    quadraticBezierTo((-w / 2).toFloat(), (hh / 2).toFloat(), (-w / 2).toFloat(), (hh / 2 - cr).toFloat())
                    close()
                }
                c.drawPath(path, fill)
            }
        }
    }

    /** Mailbox slot: dark pill cut into the box face, with rim and lip highlights. */
    private fun drawMouth(c: Canvas, e: TobiEngine, body: Path, r: Double) {
        val m = e.morph
        val hW = r * 1.8 * m
        val hH = e.slotH * r * m
        val hX = -hW / 2
        val boxTop = -r * (0.88 + 0.06 * m)
        val hY = boxTop + r * 0.08 * m

        c.save()
        c.clipPath(body)
        val rim = strokePaint(Color(255, 255, 255, (255 * 0.55 * m).toInt().coerceIn(0, 255)), 1f)
        c.drawLine(Offset((-r * 0.9 * m).toFloat(), (boxTop + 1).toFloat()), Offset((r * 0.9 * m).toFloat(), (boxTop + 1).toFloat()), rim)

        if (hH > 0.8) {
            val hR = min(hW / 2, hH / 2)
            val g = Paint().apply {
                isAntiAlias = true
                shader = LinearGradientShader(
                    Offset(0f, hY.toFloat()), Offset(0f, (hY + hH).toFloat()),
                    listOf(Color(7, 8, 10), Color(16, 19, 26)),
                )
            }
            roundRect(c, hX, hY, hW, hH, hR, g)
            if (hH > 4) {
                val lipR = min(hR, (hW - 2) / 2)
                val lip = strokePaint(Color(255, 255, 255, (255 * 0.28 * m).toInt().coerceIn(0, 255)), 1f)
                c.drawLine(
                    Offset((hX + lipR).toFloat(), (hY + hH - 0.5).toFloat()),
                    Offset((hX + hW - lipR).toFloat(), (hY + hH - 0.5).toFloat()), lip,
                )
            }
        }
        c.restore()
    }

    /** Hands sit behind the body, so they are drawn first, in world coordinates. */
    private fun drawHandsBehind(c: Canvas, e: TobiEngine, n: Double, r: Double, rx: Double, ry: Double, cx: Double, cy: Double) {
        if (e.hands <= 0.01 || e.isMini) return
        if (r <= 14) return // meaningless at compact sizes

        val bodyH = 2 * ry
        val hew = 0.3 * ry * e.hands
        val heh = 0.26 * ry * e.hands
        val hwB = rx * e.sx
        val hhB = ry * e.sy
        val isWaving = n >= e.waveStart && e.waveStart > 0 && n < e.waveUntil

        for (sd in intArrayOf(-1, 1)) {
            var localX: Double
            var localY: Double
            var handRot = 0.0

            if (sd > 0 && isWaving) {
                val wt = n - e.waveStart
                val rise = min(1.0, wt / 0.18)
                val riseEased = 1 - (1 - rise).pow(3)
                val restX = hwB * 1.08
                val restY = hhB * 0.7
                val oscX = cos(13 * wt) * 0.06 * bodyH
                val oscY = -sin(13 * wt) * 0.14 * bodyH
                val waveX = hwB * 1.1 + oscX
                val waveY = -hhB * 0.15 + oscY
                localX = restX + (waveX - restX) * riseEased
                localY = restY + (waveY - restY) * riseEased
                handRot = (-0.5 + sin(13 * wt) * 0.35) * riseEased
            } else if (sd < 0 && isWaving) {
                val wt = n - e.waveStart
                localX = -hwB * 1.08
                localY = hhB * 0.7 + sin(6 * wt) * 0.04 * bodyH
            } else {
                localX = sd * hwB * 1.08
                localY = hhB * 0.7
            }

            val cosT = cos(e.tilt)
            val sinT = sin(e.tilt)
            val worldX = cx + cosT * localX - sinT * localY
            val worldY = cy + sinT * localX + cosT * localY

            c.save()
            c.translate(worldX.toFloat(), worldY.toFloat())
            if (handRot != 0.0) c.rotate((handRot * 180 / PI).toFloat())
            val top = e.bodyColor?.mix(Rgb(1.0, 1.0, 1.0), 0.35) ?: TobiConst.BASE_TOP
            val bottom = e.bodyColor ?: TobiConst.BASE_BOTTOM
            val fill = Paint().apply {
                isAntiAlias = true
                shader = LinearGradientShader(
                    Offset((hew * 0.7).toFloat(), (-heh * 0.85).toFloat()), Offset((-hew * 0.8).toFloat(), (heh * 0.9).toFloat()),
                    listOf(top.color(), bottom.color()),
                )
            }
            val oval = Rect((-hew).toFloat(), (-heh).toFloat(), hew.toFloat(), heh.toFloat())
            c.drawOval(oval, fill)
            c.drawOval(oval, strokePaint(Color(0, 0, 0, 20), 1f))
            c.restore()
        }
    }

    private fun drawBadge(c: Canvas, e: TobiEngine, t: Double, badge: Badge, r: Double, cx: Double, cy: Double) {
        val bs = e.badgeS * (if (e.isMini) 1.25 else 1.0)
        val bx = cx - r * 0.72 * e.sx
        val by = cy - r * 0.72 * e.sy
        val col = badge.color.color()
        val black = fillPaint(Color.Black)

        c.save()
        c.translate(bx.toFloat(), by.toFloat())
        c.scale(bs.toFloat(), bs.toFloat())

        when (badge.kind) {
            BadgeKind.DOTS -> if (e.isMini) {
                val phase = (t * 2.4) % 1
                val dotR = r * 0.22 * (1 + 0.25 * sin(phase * PI * 2))
                c.drawCircle(Offset.Zero, (r * 0.2).toFloat(), black)
                c.drawCircle(Offset.Zero, dotR.toFloat(), fillPaint(col))
            } else {
                val pw = r * 0.72
                val ph = r * 0.36
                roundRect(c, -pw / 2, -ph / 2, pw, ph, ph / 2, fillPaint(col))
                for (i in 0 until 3) {
                    val phase = (((t * 2.4 - i * 0.22) % 1) + 1) % 1
                    val dotR = r * 0.055 * (1 + 0.4 * max(0.0, sin(phase * PI * 2)))
                    c.drawCircle(Offset(((i - 1) * r * 0.18).toFloat(), 0f), dotR.toFloat(), fillPaint(Color.White))
                }
            }
            BadgeKind.BANG, BadgeKind.QUESTION -> {
                c.drawCircle(Offset.Zero, (r * 0.3).toFloat(), black)
                c.drawCircle(Offset.Zero, (r * 0.23).toFloat(), fillPaint(col))
                if (!e.isMini) {
                    drawText(c, if (badge.kind == BadgeKind.BANG) "!" else "?", 0f, (r * 0.02).toFloat(), (r * 0.32).toFloat(), android.graphics.Color.WHITE, 1f)
                }
            }
            BadgeKind.DOT -> {
                c.drawCircle(Offset.Zero, (r * 0.2).toFloat(), black)
                c.drawCircle(Offset.Zero, (r * 0.135).toFloat(), fillPaint(col))
            }
        }
        c.restore()
    }

    private fun drawText(c: Canvas, s: String, x: Float, y: Float, size: Float, argb: Int, alpha: Float) {
        val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = argb
            textSize = size
            textAlign = android.graphics.Paint.Align.CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            this.alpha = (255 * alpha).toInt().coerceIn(0, 255)
        }
        val centred = y - (p.ascent() + p.descent()) / 2
        c.nativeCanvas.drawText(s, x, centred, p)
    }

    private fun drawParticles(c: Canvas, e: TobiEngine, r: Double, cx: Double, cy: Double) {
        for (p in e.particles) {
            if (p.age <= 0) continue
            val k = p.age / p.life
            val a = if (k < 0.2) k / 0.2 else 1 - (k - 0.2) / 0.8
            val px = cx + (p.x + p.vx * p.age) * r * 1.3
            val py = cy + (p.y + p.vy * p.age) * r * 1.3
            val sz = r * p.size * (1 + k * 0.4)
            val alpha = a.coerceIn(0.0, 1.0).toFloat()

            c.save()
            c.translate(px.toFloat(), py.toFloat())
            fun tinted(base: Color) = fillPaint(base.copy(alpha = alpha))
            when (p.type) {
                ParticleType.HEART -> {
                    c.rotate((sin(p.age * 6) * 0.3 * 180 / PI).toFloat())
                    c.drawPath(heartPath(sz), tinted(Color(0xFF, 0x4D, 0x6D)))
                }
                ParticleType.STAR -> {
                    c.rotate(((p.rot + p.age * 2) * 180 / PI).toFloat())
                    c.drawPath(starPath(sz, sz * 0.45), tinted(Color(0xF7, 0xB3, 0x2B)))
                }
                ParticleType.SPARK -> {
                    c.rotate((p.rot * 180 / PI).toFloat())
                    c.drawPath(starPath(sz * 0.8, sz * 0.18), tinted(Color.White))
                }
                ParticleType.SWEAT -> {
                    val path = Path().apply {
                        val s = sz.toFloat()
                        moveTo(0f, -s)
                        quadraticBezierTo(s * 0.8f, s * 0.2f, 0f, s * 0.6f)
                        quadraticBezierTo(-s * 0.8f, s * 0.2f, 0f, -s)
                    }
                    c.drawPath(path, tinted(Color(0x7C, 0xC7, 0xFF)))
                }
                ParticleType.Z -> drawText(c, "z", 0f, 0f, (sz * 1.9).toFloat(), android.graphics.Color.rgb(209, 219, 235), alpha)
            }
            c.restore()
        }
    }

    private fun lerpD(a: Double, b: Double, t: Double) = a + (b - a) * t

}
