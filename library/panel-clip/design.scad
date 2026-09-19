// Panel clip: a C-shaped jaw that grips a solar panel frame edge of measured thickness, on a
// saddle that sits over a timber rail of measured width, with one wood screw hole through
// the saddle. Class B hardware-fitted part. Licence: CC0 1.0. Authored for the michani demo,
// 2026. Family reference: open-source printed solar racking (Wittbrodt and Pearce, 2017).

// Opening of the jaw: the measured frame thickness plus clearance
jaw_opening = 35.3; // [15:60]
// Width of the saddle opening: the measured rail width plus clearance
saddle_opening = 40.3; // [20:100]
// How far the jaw reaches over the frame edge
clip_depth = 20; // [10:40]
// Wall thickness of the jaw and the saddle
wall_thickness = 4; // [2.4:8]
// Diameter of the wood screw hole through the saddle top
screw_hole_diameter = 4.5; // [3:8]
// Length of the clip along the rail
clip_length = 40; // [20:80]

$fn = 32;

saddle_height = 15;
jaw_outer = jaw_opening + 2 * wall_thickness;

module saddle() {
  // An inverted U that sits over the rail: solid block minus the rail slot.
  difference() {
    translate([-(saddle_opening / 2 + wall_thickness), 0, 0])
      cube([saddle_opening + 2 * wall_thickness, clip_length, saddle_height + wall_thickness]);
    translate([-saddle_opening / 2, -1, -1])
      cube([saddle_opening, clip_length + 2, saddle_height + 1]);
    // Screw hole down through the saddle top, centred on the rail.
    translate([0, clip_length / 2, saddle_height - 1])
      cylinder(h = wall_thickness + 2, d = screw_hole_diameter);
  }
}

module jaw() {
  // A C-shaped channel standing on the saddle top, open toward +x, gripping the frame edge.
  translate([saddle_opening / 2 + wall_thickness - jaw_outer, 0, saddle_height + wall_thickness])
    difference() {
      cube([jaw_outer, clip_length, clip_depth + wall_thickness]);
      translate([wall_thickness, -1, wall_thickness])
        cube([jaw_opening, clip_length + 2, clip_depth + 1]);
    }
}

union() {
  saddle();
  jaw();
}
