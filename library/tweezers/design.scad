// Tweezers: two flat arms joined at a bridge, class A standalone part.
// Licence: CC0 1.0. Authored for the michani demo, 2026. Reference for the part family:
// Field Ready medical item collection.

// Overall length from bridge to tip
length = 100; // [60:160]
// Width of the flat tip
tip_width = 4; // [2:8]
// Thickness of each arm
arm_thickness = 2; // [1.2:4]
// Gap between the arms at the tips when at rest
arm_gap = 10; // [4:20]
// Width of each arm at the bridge end
arm_width = 12; // [8:20]

$fn = 32;

module arm(side) {
  // A tapered plate: full width at the bridge, tip width at the end, leaning inward
  // by half the gap so the tips nearly meet when squeezed.
  hull() {
    translate([0, side * (arm_gap / 2 + arm_thickness / 2), 0])
      cube([arm_width, arm_thickness, arm_width], center = true);
    translate([length, side * (arm_gap / 2 + arm_thickness / 2), 0])
      cube([tip_width, arm_thickness, tip_width], center = true);
  }
}

module bridge() {
  // Closed end that joins the two arms and gives the spring action.
  translate([-arm_width / 2, 0, 0])
    cube([arm_thickness * 2, arm_gap + arm_thickness * 2, arm_width], center = true);
}

union() {
  arm(1);
  arm(-1);
  bridge();
}
