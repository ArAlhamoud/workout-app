// The rest timer, where the phone actually is between sets: locked, or
// glanced at past the Dynamic Island. The OS owns the countdown
// (Text(timerInterval:) / ProgressView(timerInterval:)), so this renders
// correctly even while the app is suspended — the exact case the in-app
// timer can't cover.
//
// The OS does NOT remove or grey an activity whose rest is over: it only
// flips `context.isStale` at the staleDate (set to the rest's end by
// RestActivityPlugin) and re-renders. Every presentation below therefore has
// a FINISHED state — dimmed, no clock — or a locked phone shows a bright
// "REST 0:00" until the app next runs and can end the activity.

import ActivityKit
import SwiftUI
import WidgetKit

struct RestActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            // Lock Screen / banner
            LockRestView(context: context)
        } dynamicIsland: { context in
            let over = restIsOver(context)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(over ? "REST OVER" : "REST")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(over ? Aurora.tx3 : Aurora.teal)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if over {
                        Image(systemName: "checkmark")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Aurora.tx3)
                            .padding(.trailing, 4)
                    } else {
                        Text(timerInterval: restTimerRange(context.state.endsAt), countsDown: true)
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundStyle(Aurora.teal)
                            .monospacedDigit()
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 72)
                            .padding(.trailing, 4)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Next: \(context.attributes.exerciseName)")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(over ? Aurora.tx3 : .white)
                            .lineLimit(1)
                        if !over {
                            ProgressView(
                                timerInterval: progressWindow(context),
                                countsDown: false,
                                label: { EmptyView() },
                                currentValueLabel: { EmptyView() }
                            )
                            .progressViewStyle(.linear)
                            .tint(Aurora.teal)
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(over ? Aurora.tx3 : Aurora.teal)
            } compactTrailing: {
                if over {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Aurora.tx3)
                } else {
                    Text(timerInterval: restTimerRange(context.state.endsAt), countsDown: true)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(Aurora.teal)
                        .monospacedDigit()
                        .frame(maxWidth: 40)
                }
            } minimal: {
                Image(systemName: over ? "checkmark" : "timer")
                    .foregroundStyle(over ? Aurora.tx3 : Aurora.teal)
            }
        }
    }

    /// The bar fills over the whole rest, ending exactly when the timer does.
    private func progressWindow(_ context: ActivityViewContext<RestTimerAttributes>) -> ClosedRange<Date> {
        let start = context.state.endsAt.addingTimeInterval(-Double(context.state.totalSeconds))
        // A +15s adjust moves endsAt past start+total; keep the range valid.
        return min(start, context.state.endsAt)...context.state.endsAt
    }
}

/// The rest is over. `isStale` is the OS's signal (it re-renders at the
/// staleDate); the clock check covers a render that lands after the deadline
/// for any other reason.
func restIsOver(_ context: ActivityViewContext<RestTimerAttributes>) -> Bool {
    context.isStale || context.state.endsAt <= Date.now
}

/// `now...endsAt` inverts once the deadline passes, and SwiftUI renders an
/// inverted timer range as visual garbage (seen on the simulator as a
/// shattered Island). Clamp so a stale activity shows a clean 0:00 instead.
func restTimerRange(_ endsAt: Date) -> ClosedRange<Date> {
    min(Date.now, endsAt)...endsAt
}

private struct LockRestView: View {
    let context: ActivityViewContext<RestTimerAttributes>

    var body: some View {
        let over = restIsOver(context)
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(over ? "REST OVER" : "REST")
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(1.2)
                    .foregroundStyle(over ? Aurora.tx3 : Aurora.teal)
                Text("Next: \(context.attributes.exerciseName)")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(over ? Aurora.tx2 : .white)
                    .lineLimit(1)
            }
            Spacer()
            if over {
                Image(systemName: "checkmark")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Aurora.tx3)
            } else {
                Text(timerInterval: restTimerRange(context.state.endsAt), countsDown: true)
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(Aurora.teal)
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 96)
            }
        }
        .padding(16)
        .activityBackgroundTint(Aurora.bg.opacity(over ? 0.6 : 0.85))
        .activitySystemActionForegroundColor(over ? Aurora.tx3 : Aurora.teal)
    }
}
