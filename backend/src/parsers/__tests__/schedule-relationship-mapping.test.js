const {
  extractRelationships,
  parseXer,
} = require('../xer-parser');
const { parseP6Xml } = require('../p6xml-parser');
const { parseMspXml, parseLagDays } = require('../msp-parser');

describe('schedule importer relationship mapping', () => {
  it('maps XER relationship types and negative lag to structured fields', () => {
    const tables = parseXer(
      [
        '%T\tTASKPRED',
        '%F\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
        '%R\t200\t100\tPR_SS\t-16',
        '%R\t300\t200\tPR_FF\t8',
      ].join('\n'),
    );

    expect(extractRelationships(tables)).toEqual([
      {
        succTaskId: '200',
        predTaskId: '100',
        relType: 'SS',
        lagDays: -2,
      },
      {
        succTaskId: '300',
        predTaskId: '200',
        relType: 'FF',
        lagDays: 1,
      },
    ]);
  });

  it('maps P6 XML relationship types and negative lag to structured fields', async () => {
    const parsed = await parseP6Xml(`
      <Project>
        <Activities>
          <Activity><ObjectId>1</ObjectId><Id>A</Id><Name>A</Name></Activity>
          <Activity><ObjectId>2</ObjectId><Id>B</Id><Name>B</Name></Activity>
        </Activities>
        <Relationships>
          <Relationship>
            <PredecessorActivityObjectId>1</PredecessorActivityObjectId>
            <SuccessorActivityObjectId>2</SuccessorActivityObjectId>
            <Type>Start to Finish</Type>
            <Lag>-8</Lag>
          </Relationship>
        </Relationships>
      </Project>
    `);

    expect(parsed.relationships).toEqual([
      {
        succId: '2',
        predId: '1',
        type: 'SF',
        lagDays: -1,
      },
    ]);
  });

  it('maps MSP predecessor links and signed lag values', async () => {
    const parsed = await parseMspXml(`
      <Project>
        <Tasks>
          <Task>
            <UID>1</UID>
            <ID>1</ID>
            <Name>A</Name>
            <Summary>0</Summary>
          </Task>
          <Task>
            <UID>2</UID>
            <ID>2</ID>
            <Name>B</Name>
            <Summary>0</Summary>
            <PredecessorLink>
              <PredecessorUID>1</PredecessorUID>
              <Type>3</Type>
              <LinkLag>-9600</LinkLag>
            </PredecessorLink>
          </Task>
        </Tasks>
      </Project>
    `);

    expect(parsed.tasks[1].predecessors).toEqual([
      {
        predUid: '1',
        type: 'SS',
        lagDurationIso: '-9600',
      },
    ]);
    // MSPDI LinkLag is in tenths of a minute: -9600 = -2 working days.
    expect(parseLagDays(parsed.tasks[1].predecessors[0].lagDurationIso)).toBe(
      -2,
    );
    expect(parseLagDays('-PT16H0M0S')).toBe(-2);
  });
});
