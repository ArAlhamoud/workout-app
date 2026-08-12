// The rest timer, where the phone actually is between sets: locked, or
// glanced at past the Dynamic Island. The OS owns the countdown
// (Text(timerInterval:) / ProgressView(timerInterval:)), so this renders
// correctly even while the app is suspended — the exact case the in-app
// timer can't cover.

import ActivityKit
import SwiftUI
import WidgetKit

struct RestActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            // Lock Screen / banner
            LockRestView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("REST")
                        .font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(Aurora.teal)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: restTimerRange(context.state.endsAt), countsDown: true)
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundStyle(Aurora.teal)
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 72)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Next: \(context.attributes.exerciseName)")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        ProgressView(
                            timerInterval: progressWindow(context),
                            countsDown: false,
                            label: { EmptyView() },
                            currentValueLabel: { EmptyView() }
                        )
                        .progressViewStyle(.linear)
                        .tint(Aurora.teal)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(Aurora.teal)
            } compactTrailing: {
                Text(timerInterval: restTimerRange(context.state.endsAt), countsDown: true)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(Aurora.teal)
                    .monospacedDigit()
                    .frame(maxWidth: 40)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(Aurora.teal)
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

/// `now...endsAt` inverts once the deadline passes, and SwiftUI renders an
/// inverted timer range as visual garbage (seen on the simulator as a
/// shattered Island). Clamp so a stale activity shows a clean 0:00 instead.
func restTimerRange(_ endsAt: Date) -> ClosedRange<Date> {
    min(Date.now, endsAt)...endsAt
}

private struct LockRestView: View {
    let context: ActivityViewContext<RestTimerAttributes>

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("REST")
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(1.2)
                    .foregroundStyle(Aurora.teal)
                Text("Next: \(context.attributes.exerciseName)")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }
            Spacer()
            Text(timerInterval: restTimerRange(context.state.endsAt), countsDown: true)
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundStyle(Aurora.teal)
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 96)
        }
        .padding(16)
        .activityBackgroundTint(Aurora.bg.opacity(0.85))
        .activitySystemActionForegroundColor(Aurora.teal)
    }
}
