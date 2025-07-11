import { beginCell, Builder, Cell, Slice } from '@ton/core';
import { serializeDict } from '@ton/core/dist/dict/serializeDict';
import { parseTLB, tryParseCell } from '../src';
import fs from 'fs';
import path from 'path';
import { NameExpr } from '@ton-community/tlb-parser';

const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('Cell parsing', () => {
    test('parse simple bool cell', () => {
        const tlb = 'bool_true$1 = Bool;';
        const program = parseTLB(tlb);
        const builder = new Builder();
        builder.storeBit(1);
        const cell = builder.endCell();
        const res = tryParseCell(cell, program, 'Bool');
        expect(res.result._id).toBe('bool_true$1');
    });

    test('parse nested structure', () => {
        const tlb2 = `inner$100 value:uint32 = Inner; outer$101 inner:^Inner flag:Bool = Outer;`;
        const defs = parseTLB(tlb2);

        const innerBuilder = new Builder();
        innerBuilder.storeUint(0b100, 3);
        innerBuilder.storeUint(7, 32);
        const inner = innerBuilder.endCell();

        const outerBuilder = new Builder();
        outerBuilder.storeUint(0b101, 3);
        outerBuilder.storeRef(inner);
        outerBuilder.storeBit(1);
        const outer = outerBuilder.endCell();

        const res = tryParseCell(outer, defs, 'outer');
        expect(res.result._id).toBe('outer$101');
        expect(res.result.inner._id).toBe('inner$100');
        expect(res.result.inner.value.toString()).toBe('7');
        expect(res.result.flag).toBe(true);
    });

    test('parse generic maybe cell', () => {
        const tlb3 = 'nothing$0 {X:Type} = Maybe X; just$1 {X:Type} value:X = Maybe X;';
        const defs = parseTLB(tlb3);

        const builder = new Builder();
        builder.storeBit(1); // tag for just
        builder.storeUint(7, 32);
        const cell = builder.endCell();

        const res = tryParseCell(cell, defs, 'Maybe', [new NameExpr('uint32')]);
        expect(res.result._id).toBe('just$1');
        expect(res.result.value.toString()).toBe('7');
    });

    test('conditional field parsing', () => {
        const tlb4 = 'foo$_ flag:Bool value:flag?uint8 = Foo;';
        const defs = parseTLB(tlb4);

        const b1 = new Builder();
        b1.storeBit(1); // flag
        b1.storeUint(17, 8);
        const c1 = b1.endCell();

        const r1 = tryParseCell(c1, defs, 'foo');
        expect(r1.result.flag).toBe(true);
        expect(r1.result.value.toString()).toBe('17');

        const b2 = new Builder();
        b2.storeBit(0); // flag
        const c2 = b2.endCell();

        const r2 = tryParseCell(c2, defs, 'foo');
        expect(r2.result.flag).toBe(false);
        expect(r2.result.value).toBeUndefined();
    });

    test('partial result on failure', () => {
        const tlb2 = `inner$100 value:uint32 = Inner; outer$101 inner:^Inner flag:Bool = Outer;`;
        const defs = parseTLB(tlb2);

        const innerBuilder = new Builder();
        innerBuilder.storeUint(0b100, 3);
        innerBuilder.storeUint(7, 32);
        const inner = innerBuilder.endCell();

        const outerBuilder = new Builder();
        outerBuilder.storeUint(0b101, 3);
        outerBuilder.storeRef(inner);
        // omit flag bit to trigger failure
        const outer = outerBuilder.endCell();

        const res = tryParseCell(outer, defs, 'Outer');
        expect(res.result._id).toBe('outer$101');
        expect(res.result.inner._id).toBe('inner$100');
        expect(res.result.flag).toBeUndefined();
        expect(res.result._error).toBeDefined();
        expect(res.result._remaining).toBeDefined();
        expect(Array.isArray(res.errors)).toBe(true);
    });

    test('continue parsing after ref failure', () => {
        const tlb2 = `inner$100 value:uint8 flag:Bool = Inner; outer$101 inner:^Inner other:uint8 = Outer;`;
        const defs = parseTLB(tlb2);

        const badInnerBuilder = new Builder();
        badInnerBuilder.storeUint(0b100, 3);
        badInnerBuilder.storeUint(7, 8); // missing flag bit
        const badInner = badInnerBuilder.endCell();

        const outerBuilder = new Builder();
        outerBuilder.storeUint(0b101, 3);
        outerBuilder.storeRef(badInner);
        outerBuilder.storeUint(9, 8);
        const outer = outerBuilder.endCell();

        const res = tryParseCell(outer, defs, 'Outer');
        expect(res.result._id).toBe('outer$101');
        expect(res.result.other.toString()).toBe('9');
        expect(res.result.inner._error).toBeDefined();
        expect(res.result.inner._remaining).toBeDefined();
    });

    test('parse MsgAddress union', () => {
        const tlb = fs.readFileSync(path.resolve(fixturesDir, 'block.tlb'), 'utf-8');
        const program = parseTLB(tlb);

        const b = new Builder();
        b.storeUint(0b10, 2); // addr_std tag
        b.storeBit(0); // nothing in Maybe Anycast
        b.storeInt(0, 8); // workchain_id
        b.storeUint(0, 256); // address
        const cell = b.endCell();

        const res = tryParseCell(cell, program, 'MsgAddress');
        expect(res.result._id).toBe('_');
        expect(res.result._._id).toBe('addr_std$10');
    });

    test('parse block', () => {
        const tlb = fs.readFileSync(path.resolve(fixturesDir, 'block.tlb'), 'utf-8');
        const boc = fs.readFileSync(path.resolve(fixturesDir, 'block.boc'));
        const cell = Cell.fromBoc(boc)[0];
        const program = parseTLB(tlb);
        const res = tryParseCell(cell, program, 'Block');
        // console.log(JSON.stringify(res, (k, v) => {
        //     if (typeof v == 'bigint') return v.toString();
        //     if (v instanceof Slice) return v.asCell().toBoc().toString('base64');
        //     if (v instanceof Cell) return v.toBoc().toString('base64');
        //     return v;
        // }, 4));
        expect(res.result._id).toBe('block#11ef55aa');
    });
});

describe('Dictionary parsing', () => {
    const tlb = fs.readFileSync(path.resolve(fixturesDir, 'block.tlb'), 'utf-8') + '\ndict_test$_ dict:(HashmapE 16 uint16) = DictTest;';
    const program = parseTLB(tlb);

    test('parse non-empty dictionary', () => {
        const map = new Map<bigint, number>();
        map.set(1n, 10);
        map.set(2n, 20);

        const dictBuilder = beginCell();
        serializeDict(map, 16, (v: number, b: Builder) => b.storeUint(v, 16), dictBuilder);
        const root = dictBuilder.endCell();

        const builder = beginCell();
        builder.storeBit(1);
        builder.storeRef(root);
        const cell = builder.endCell();

        const res = tryParseCell(cell, program, 'dict_test');
        console.log(res);
    });

    test('parse empty dictionary', () => {
        const builder = beginCell();
        builder.storeBit(0);
        const cell = builder.endCell();

        const res = tryParseCell(cell, program, 'dict_test');
        expect(res.result.dict._id).toBe('hme_empty$0');
    });
});

describe('NegateExpr', () => {
    test.skip('parse unary number', () => {
        const tlb = `unary_zero$0 = Unary ~0; unary_succ$1 {n:#} x:(Unary ~n) = Unary ~(n + 1); bitstring$_ len:(Unary ~n) s:(n * Bit) = BitString;`;
        const program = parseTLB(tlb);
        const cell = beginCell().storeUint(0b110, 3).storeUint(0b10, 2).endCell();
        const res = tryParseCell(cell, program, 'BitString');
        expect(res.result._id).toBe('bitstring$_');
        expect(res.result.len._id).toBe('unary_succ$1');
        expect(res.result.len.x._id).toBe('unary_succ$1');
        expect(res.result.len.x.x._id).toBe('unary_zero$0');
        expect(res.result.s).toBeDefined();
    });
});