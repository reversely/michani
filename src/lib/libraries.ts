export const libraries = [
  {
    // https://github.com/openscad/MCAD
    name: 'MCAD',
    description: 'A library for OpenSCAD that includes a number of utilities.',
    url: `${import.meta.env.BASE_URL}/libraries/MCAD.zip`,
  },
  {
    // https://github.com/BelfrySCAD/BOSL2/
    name: 'BOSL2',
    description: 'A library for OpenSCAD that includes a number of utilities.',
    url: `${import.meta.env.BASE_URL}/libraries/BOSL2.zip`,
  },
  {
    // https://github.com/nophead/NopSCADlib (GPL-3.0). Subset: core, global_defs, lib,
    // vitamins, utils. Supplies purchased-part geometry such as perf boards for previews.
    name: 'NopSCADlib',
    description:
      'Vitamins (purchased parts) and utilities for OpenSCAD, used for hardware previews.',
    url: `${import.meta.env.BASE_URL}/libraries/NopSCADlib.zip`,
  },
  {
    // https://github.com/revarbat/BOSL
    name: 'BOSL',
    description: 'A library for OpenSCAD that includes a number of utilities.',
    url: `${import.meta.env.BASE_URL}/libraries/BOSL.zip`,
  },
];
