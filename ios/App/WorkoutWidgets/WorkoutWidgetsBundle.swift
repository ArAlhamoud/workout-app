// The widget extension's entry point: one Home/Lock Screen widget and the
// rest-timer Live Activity. Trip 2 of docs/MAC_NATIVE_TRIP.md, unblocked by
// the paid team (263G7A2Q2N).

import SwiftUI
import WidgetKit

@main
struct WorkoutWidgetsBundle: WidgetBundle {
    var body: some Widget {
        VerdictWidget()
        RestActivityWidget()
    }
}
