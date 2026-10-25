package com.sailxx.tobi.app

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.view.View
import android.widget.RemoteViews
import com.sailxx.tobi.R
import com.sailxx.tobi.core.WidgetContent
import com.sailxx.tobi.core.WidgetSpoken

/**
 * The Tobi Mood widget: only Tobi's face in the current state, with his glow. Drawn by [WidgetHub] when something changes
 * (updatePeriodMillis = 0). A tap opens the top agent, or the app. It only opens things.
 */
class MoodWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
        WidgetHub.refresh(context, manager, ids) { c, w -> views(c, w) }

    companion object {
        fun views(context: Context, c: WidgetContent): RemoteViews {
            val v = RemoteViews(context.packageName, R.layout.widget_mood)
            WidgetHub.paint(v, R.id.mood_root, R.id.mood_tint, c.look)
            v.setImageViewBitmap(R.id.mood_face, TobiBitmap.of(c.mood, WidgetHub.px(context, 64), glow = true, tone = c.look))
            v.setContentDescription(R.id.mood_face, context.getString(R.string.widget_tobi_description, (c.top?.stateWord ?: c.headline).lowercase()))
            v.setViewVisibility(R.id.mood_offline, if (c.connected) View.GONE else View.VISIBLE)
            val top = c.top
            v.setContentDescription(R.id.mood_root, WidgetSpoken.top(c))
            v.setOnClickPendingIntent(
                R.id.mood_root,
                if (top != null) WidgetHub.openSession(context, WidgetHub.CODE_MOOD, top.pillId) else WidgetHub.openApp(context, WidgetHub.CODE_MOOD),
            )
            return v
        }
    }
}
