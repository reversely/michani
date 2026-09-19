// Key turner: a lever handle that grips a house key head so a person with limited grip
// strength can turn it. Class A standalone part. Licence: CC0 1.0. Authored for the michani
// demo, 2026, from scratch; the part family follows the Makers Making Change low-tech
// assistive devices kit.

// Length of the lever handle
handle_length = 90; // [60:140]
// Width of the handle
handle_width = 24; // [16:40]
// Thickness of the handle and the key slot walls
thickness = 8; // [5:14]
// Width of the slot that holds the key head
key_slot_width = 3; // [2:5]
// Depth of the key slot from the handle end
key_slot_depth = 22; // [12:35]

$fn = 32;

module handle_body() {
  // A rounded bar: two cylinders hulled so the grip has no sharp corners.
  hull() {
    translate([handle_width / 2, 0, 0]) cylinder(h = thickness, d = handle_width);
    translate([handle_length - handle_width / 2, 0, 0]) cylinder(h = thickness, d = handle_width);
  }
}

module key_slot() {
  // The slot enters from the handle end and stops before the thumb area, with a small
  // extra depth so the key head seats fully.
  translate([handle_length - key_slot_depth, -key_slot_width / 2, -1])
    cube([key_slot_depth + 1, key_slot_width, thickness + 2]);
}

module finger_hole() {
  // A hole at the free end lets the turner hang on a hook or a lanyard.
  translate([handle_width / 2, 0, -1]) cylinder(h = thickness + 2, d = 6);
}

difference() {
  handle_body();
  key_slot();
  finger_hole();
}
