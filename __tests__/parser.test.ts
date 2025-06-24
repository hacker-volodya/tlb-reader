import { parseTLB } from '../src';
import fs from 'fs';
import { FieldNamedDef, CombinatorExpr } from '@ton-community/tlb-parser';

describe('TLB parser', () => {
    test('parse block.tlb', () => {
        const tlb = fs.readFileSync('block.tlb', 'utf-8');
        const program = parseTLB(tlb);
        expect(program.declarations.length).toBeGreaterThan(0);
    });

    test('parse complex definition', () => {
        const tlb = 'block_extra in_msg_descr:^InMsgDescr out_msg_descr:^OutMsgDescr account_blocks:^ShardAccountBlocks rand_seed:bits256 created_by:bits256 custom:(Maybe ^McBlockExtra) = BlockExtra;';
        const program = parseTLB(tlb);
        const field = program.declarations[0].fields[5] as FieldNamedDef;
        expect(field.expr instanceof CombinatorExpr && field.expr.name === 'Maybe').toBe(true);
    });
});
