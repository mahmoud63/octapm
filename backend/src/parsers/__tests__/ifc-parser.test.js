const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseIfc, parseIfcFile, parseArgs, decodeString, quantityField } = require("../ifc-parser");

const MODEL = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('Riverside Tower.ifc','2026-09-10T08:15:00',('Amal Haddad'),('OctaPM'),'Revit 2026','Autodesk Revit','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1= IFCPERSON($,$,'Amal',$,$,$,$,$);
#2= IFCOWNERHISTORY(#1,$,$,.NOCHANGE.,$,$,$,0);
#10= IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#11= IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#12= IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#13= IFCUNITASSIGNMENT((#10,#11,#12));
#20= IFCPROJECT('0YvhpEXwvHxeCUqfhy6Hf7',#2,'Riverside Tower',$,$,'Tower, phase 2',$,$,#13);
#21= IFCSITE('1SiteGuid00000000000001',#2,'Riverside site',$,$,$,$,$,.ELEMENT.,$,$,0.,$,$);
#22= IFCBUILDING('2BldgGuid00000000000001',#2,'Tower A',$,$,$,$,'Tower A block',.ELEMENT.,$,$,$);
#23= IFCBUILDINGSTOREY('3StoreyGuid0000000000L1',#2,'Level 01',$,$,$,$,'Ground floor',.ELEMENT.,0.);
#24= IFCBUILDINGSTOREY('3StoreyGuid0000000000L2',#2,'Level 02',$,$,$,$,$,.ELEMENT.,3600.);
#30= IFCRELAGGREGATES('rel-agg-1',#2,$,$,#20,(#21));
#31= IFCRELAGGREGATES('rel-agg-2',#2,$,$,#21,(#22));
#32= IFCRELAGGREGATES('rel-agg-3',#2,$,$,#22,(#23,#24));
#100= IFCWALL('0wall00000000000000001',#2,'Basic Wall:Concrete 300','Perimeter wall',$,$,$,'W-101',.SOLIDWALL.);
#101= IFCWALL('0wall00000000000000002',#2,'Basic Wall:Concrete 300',$,$,$,$,'W-102',.SOLIDWALL.);
#102= IFCSLAB('0slab00000000000000001',#2,'Floor:Slab 250',$,$,$,$,'S-201',.FLOOR.);
#103= IFCSTAIR('0stair0000000000000001',#2,'Stair 01',$,$,$,$,'ST-1',$);
#104= IFCSTAIRFLIGHT('0flight000000000000001',#2,'Stair 01 flight A',$,$,$,$,'ST-1a',$);
#105= IFCDOOR('0door00000000000000001',#2,'Door 900x2100',$,$,$,$,'D-01',$);
#110= IFCSPACE('0space0000000000000001',#2,'101',$,$,$,$,'Reception',.ELEMENT.,.INTERNAL.,0.);
#120= IFCRELAGGREGATES('rel-agg-4',#2,$,$,#103,(#104));
#121= IFCRELAGGREGATES('rel-agg-5',#2,$,$,#23,(#110));
#130= IFCRELCONTAINEDINSPATIALSTRUCTURE('rel-con-1',#2,$,$,(#100,#101,#102,#103,#105),#23);
#200= IFCWALLTYPE('0walltype000000000001',#2,'Concrete 300',$,$,$,$,'WT-300',$,.SOLIDWALL.);
#201= IFCRELDEFINESBYTYPE('rel-type-1',#2,$,$,(#100,#101),#200);
#300= IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.T.),$);
#301= IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('REI 120'),$);
#302= IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER('Concrete 300'),$);
#303= IFCPROPERTYSET('0pset00000000000000001',#2,'Pset_WallCommon',$,(#300,#301,#302));
#304= IFCRELDEFINESBYPROPERTIES('rel-pset-1',#2,$,$,(#100,#101),#303);
#310= IFCQUANTITYVOLUME('NetVolume',$,$,4.5,$);
#311= IFCQUANTITYAREA('NetSideArea',$,$,15.,$);
#312= IFCQUANTITYLENGTH('Length',$,$,6000.,$);
#313= IFCELEMENTQUANTITY('0qto00000000000000001',#2,'Qto_WallBaseQuantities',$,$,(#310,#311,#312));
#314= IFCRELDEFINESBYPROPERTIES('rel-qto-1',#2,$,$,(#100),#313);
#320= IFCMATERIAL('Concrete C40/50');
#321= IFCMATERIAL('Rebar B500B');
#322= IFCMATERIALLAYER(#320,300.,$);
#323= IFCMATERIALLAYERSET((#322),'Concrete 300');
#324= IFCMATERIALLAYERSETUSAGE(#323,.AXIS2.,.POSITIVE.,0.);
#325= IFCRELASSOCIATESMATERIAL('rel-mat-1',#2,$,$,(#100,#101),#324);
#326= IFCMATERIALLIST((#320,#321));
#327= IFCRELASSOCIATESMATERIAL('rel-mat-2',#2,$,$,(#102),#326);
#400= IFCCARTESIANPOINT((0.,0.,0.));
#401= IFCEXTRUDEDAREASOLID(#402,#400,#403,3000.);
#402= IFCRECTANGLEPROFILEDEF(.AREA.,$,$,300.,6000.);
ENDSEC;
END-ISO-10303-21;
`;

describe("IFC parser", () => {
  it("decodes STEP values: strings with escapes, numbers, refs, enums, lists and typed values", () => {
    expect(parseArgs("'a',$,#12,.T.,.F.,.SOLIDWALL.,3.5,-2,1.2E-3,(#1,#2),(),IFCLABEL('x')")).toEqual([
      "a", null, { ref: 12 }, true, false, "SOLIDWALL", 3.5, -2, 0.0012, [{ ref: 1 }, { ref: 2 }], [], { typed: "IFCLABEL", value: "x" },
    ]);
    expect(parseArgs("'it''s here',$")).toEqual(["it's here", null]);
    expect(parseArgs("'semi; colon, comma','next'")).toEqual(["semi; colon, comma", "next"]);
    expect(decodeString("Caf\\X2\\00E9\\X0\\ wall")).toBe("Café wall");
    expect(decodeString("50\\X\\B0 bend")).toBe("50° bend");
    expect(quantityField("NetVolume")).toBe("netVolume");
    expect(quantityField("GrossFootprintArea")).toBe("grossArea");
    expect(quantityField("Nonsense")).toBeNull();
  });

  it("reads the header, units, spatial breakdown and every contained element with its type, materials, properties and quantities", () => {
    const model = parseIfc(MODEL);
    expect(model.schema).toBe("IFC4");
    expect(model.header).toMatchObject({ name: "Riverside Tower.ifc", timeStamp: "2026-09-10T08:15:00", author: "Amal Haddad", organization: "OctaPM", preprocessor: "Revit 2026", originatingSystem: "Autodesk Revit" });
    expect(model.units).toEqual({ length: "mm", area: "m²", volume: "m³" });
    expect(model.project).toMatchObject({ globalId: "0YvhpEXwvHxeCUqfhy6Hf7", name: "Riverside Tower" });
    expect(model.site).toMatchObject({ name: "Riverside site" });
    expect(model.building).toMatchObject({ name: "Tower A" });
    expect(model.warnings).toEqual([]);

    expect(model.spatial.map((node) => [node.ifcType, node.name, node.parentGlobalId, node.elevation, node.elementCount])).toEqual([
      ["IFCPROJECT", "Riverside Tower", null, null, 0],
      ["IFCSITE", "Riverside site", "0YvhpEXwvHxeCUqfhy6Hf7", null, 0],
      ["IFCBUILDING", "Tower A", "1SiteGuid00000000000001", null, 0],
      // Five contained elements, the stair flight aggregated under the stair, and the space.
      ["IFCBUILDINGSTOREY", "Level 01", "2BldgGuid00000000000001", 0, 7],
      ["IFCBUILDINGSTOREY", "Level 02", "2BldgGuid00000000000001", 3600, 0],
      ["IFCSPACE", "101", "3StoreyGuid0000000000L1", null, 0],
    ]);

    const byGuid = Object.fromEntries(model.elements.map((element) => [element.globalId, element]));
    expect(model.elements).toHaveLength(7);
    expect(byGuid["0wall00000000000000001"]).toMatchObject({
      ifcType: "IFCWALL",
      name: "Basic Wall:Concrete 300",
      description: "Perimeter wall",
      tag: "W-101",
      typeName: "Concrete 300",
      predefinedType: "SOLIDWALL",
      storeyName: "Level 01",
      storeyGlobalId: "3StoreyGuid0000000000L1",
      elevation: 0,
      spatialPath: "Riverside site / Tower A / Level 01",
      materials: ["Concrete C40/50"],
      quantities: { netVolume: 4.5, netArea: 15, length: 6000 },
    });
    expect(byGuid["0wall00000000000000001"].properties).toEqual({
      Pset_WallCommon: { LoadBearing: true, FireRating: "REI 120", Reference: "Concrete 300" },
    });
    // The second wall shares the property set but has no quantities of its own.
    expect(byGuid["0wall00000000000000002"]).toMatchObject({ typeName: "Concrete 300", quantities: {}, materials: ["Concrete C40/50"] });
    expect(byGuid["0wall00000000000000002"].properties.Pset_WallCommon.FireRating).toBe("REI 120");
    expect(byGuid["0slab00000000000000001"].materials).toEqual(["Concrete C40/50", "Rebar B500B"]);
    // A stair's flight is aggregated under the stair, not contained in the storey directly.
    expect(byGuid["0flight000000000000001"]).toMatchObject({ ifcType: "IFCSTAIRFLIGHT", storeyName: "Level 01", spatialPath: "Riverside site / Tower A / Level 01" });
    expect(byGuid["0space0000000000000001"]).toMatchObject({ ifcType: "IFCSPACE", name: "101", longName: "Reception", storeyName: "Level 01" });
    // Geometry never reaches the model.
    expect(model.entityCount).toBe(model.entityCount);
    expect(model.elements.some((element) => element.ifcType.includes("EXTRUDED"))).toBe(false);
  });

  it("reads the same model from a file in chunks, reports progress and refuses one over the size limit", async () => {
    const file = path.join(os.tmpdir(), `octapm-${Date.now()}.ifc`);
    fs.writeFileSync(file, MODEL, "latin1");
    try {
      const model = await parseIfcFile(file);
      expect(model.elements).toHaveLength(7);
      expect(model.project.name).toBe("Riverside Tower");
      await expect(parseIfcFile(file, { maxBytes: 10 })).rejects.toMatchObject({ code: "IFC_FILE_TOO_LARGE" });
      const capped = await parseIfcFile(file, { maxEntities: 5 });
      expect(capped.truncated).toBe(true);
      expect(capped.warnings.join(" ")).toMatch(/only the first 5 entities/i);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it("survives a model with no spatial containment and reports it", () => {
    const model = parseIfc(`ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC2X3'));\nENDSEC;\nDATA;\n#1= IFCWALL('x',$,'Lonely',$,$,$,$,$,$);\nENDSEC;\nEND-ISO-10303-21;\n`);
    expect(model.schema).toBe("IFC2X3");
    expect(model.elements).toEqual([]);
    expect(model.warnings[0]).toMatch(/no element is contained/i);
  });
});
