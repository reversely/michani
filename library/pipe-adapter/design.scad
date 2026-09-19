// Pipe adapter: a stepped sleeve with a socket at each end that a pipe of measured outer
// diameter slides into, and a stop shoulder between them. Class B hardware-fitted part.
// Licence: CC0 1.0. Authored for the michani demo, 2026.

// Inner diameter of socket A: the measured pipe outer diameter plus clearance
socket_a_diameter = 25.3; // [8:120]
// Inner diameter of socket B: the measured pipe outer diameter plus clearance
socket_b_diameter = 32.3; // [8:120]
// How far each pipe slides into its socket
socket_depth = 25; // [10:60]
// Wall thickness around each socket
wall_thickness = 3; // [1.6:6]
// Thickness of the internal stop shoulder between the sockets
shoulder_thickness = 3; // [1.6:6]

$fn = 64;

outer_a = socket_a_diameter + 2 * wall_thickness;
outer_b = socket_b_diameter + 2 * wall_thickness;
total_height = 2 * socket_depth + shoulder_thickness;

module outer_body() {
  // Socket A below, a short cone up to socket B above, so the outside steps smoothly.
  cylinder(h = socket_depth, d = outer_a);
  translate([0, 0, socket_depth]) cylinder(h = shoulder_thickness, d1 = outer_a, d2 = outer_b);
  translate([0, 0, socket_depth + shoulder_thickness]) cylinder(h = socket_depth, d = outer_b);
}

module socket_a() {
  translate([0, 0, -1]) cylinder(h = socket_depth + 1, d = socket_a_diameter);
}

module socket_b() {
  translate([0, 0, socket_depth + shoulder_thickness]) cylinder(h = socket_depth + 1, d = socket_b_diameter);
}

module flow_bore() {
  // The shoulder keeps the pipes from meeting but must not block flow: bore it to the
  // smaller socket minus twice the wall, never below 4 mm.
  bore = max(4, min(socket_a_diameter, socket_b_diameter) - 2 * wall_thickness);
  translate([0, 0, socket_depth - 1]) cylinder(h = shoulder_thickness + 2, d = bore);
}

difference() {
  outer_body();
  socket_a();
  socket_b();
  flow_bore();
}
