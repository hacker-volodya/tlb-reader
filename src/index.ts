import { Cell, Slice } from '@ton/core';
import {
    ast as parseTLB,
    Program,
    Declaration,
    FieldDefinition,
    FieldBuiltinDef,
    FieldCurlyExprDef,
    FieldAnonymousDef,
    FieldNamedDef,
    FieldExprDef,
    NameExpr,
    NumberExpr,
    BuiltinOneArgExpr,
    CombinatorExpr,
    CellRefExpr,
    TypeExpr,
    CondExpr,
} from '@ton-community/tlb-parser';

export { parseTLB };

export function parseCell(
    cell: Cell,
    program: Program,
    root: string,
    args: TypeExpr[] = [],
): any {
    const slice = cell.beginParse();
    return parseByType(slice, root, program, args, {});
}

function findConstructor(program: Program, name: string): Declaration | undefined {
    return program.declarations.find(d => d.constructorDef.name === name);
}

function findCombinators(program: Program, name: string): Declaration[] {
    return program.declarations.filter(d => d.combinator.name === name);
}

function parseByType(
    slice: Slice,
    name: string,
    program: Program,
    args: TypeExpr[] = [],
    env: Record<string, TypeExpr> = {},
): any {
    const byResult = findCombinators(program, name);
    if (byResult.length > 0) {
        for (const d of byResult) {
            if (matchTag(slice, d.constructorDef.tag)) {
                return parseDecl(slice, d, program, args, env, true);
            }
        }
        throw new Error('No matching constructor for ' + name);
    }
    const cons = findConstructor(program, name);
    if (cons) {
        return parseDecl(slice, cons, program, args, env, false);
    }
    throw new Error('Type ' + name + ' not found');
}

function parseDecl(
    slice: Slice,
    decl: Declaration,
    program: Program,
    args: TypeExpr[],
    env: Record<string, TypeExpr>,
    readPrefix: boolean,
): any {
    if (readPrefix) {
        readTag(slice, decl.constructorDef.tag);
    }
    const localEnv: Record<string, TypeExpr> = { ...env };
    let idx = 0;
    for (const f of decl.fields) {
        if (f instanceof FieldBuiltinDef && f.type === 'Type') {
            if (idx < args.length) {
                localEnv[f.name] = args[idx++];
            }
        }
    }
    const result = parseFields(slice, decl.fields, program, localEnv);
    const tag = decl.constructorDef.tag || '';
    result['_id'] = decl.constructorDef.name + tag;
    return result;
}

function matchTag(slice: Slice, tag: string | null): boolean {
    if (!tag || tag === '#_' || tag === '$_') return true;
    const { bits, value } = parseTag(tag);
    if (bits === 0) return true;
    return slice.preloadUintBig(bits) === value;
}

function readTag(slice: Slice, tag: string | null) {
    if (!tag || tag === '#_' || tag === '$_') return;
    const { bits } = parseTag(tag);
    if (bits > 0) {
        slice.skip(bits);
    }
}

function parseTag(tag: string): { bits: number; value: bigint } {
    if (tag.startsWith('$')) {
        const b = tag.slice(1);
        if (b === '_') return { bits: 0, value: 0n };
        return { bits: b.length, value: BigInt('0b' + b) };
    } else if (tag.startsWith('#')) {
        const h = tag.slice(1);
        if (h === '_') return { bits: 0, value: 0n };
        return { bits: h.length * 4, value: BigInt('0x' + h) };
    }
    return { bits: 0, value: 0n };
}

function parseFields(
    slice: Slice,
    fields: FieldDefinition[],
    program: Program,
    env: Record<string, TypeExpr>,
): any {
    const res: any = {};
    for (const f of fields) {
        if (f instanceof FieldBuiltinDef || f instanceof FieldCurlyExprDef) {
            continue;
        } else if (f instanceof FieldNamedDef) {
            res[f.name] = parseExpr(slice, f.expr, program, env);
        } else if (f instanceof FieldExprDef) {
            res['_'] = parseExpr(slice, f.expr, program, env);
        } else if (f instanceof FieldAnonymousDef) {
            const subSlice = f.isRef ? slice.loadRef().beginParse() : slice;
            res[f.name || '_'] = parseFields(subSlice, f.fields, program, env);
        }
    }
    return res;
}

function parseAnon(
    slice: Slice,
    fields: FieldDefinition[],
    program: Program,
    env: Record<string, TypeExpr>,
): any {
    return parseFields(slice, fields, program, env);
}

function resolveTypeExpr(expr: TypeExpr, env: Record<string, TypeExpr>): TypeExpr {
    if (expr instanceof NameExpr && env[expr.name]) {
        return resolveTypeExpr(env[expr.name], env);
    }
    if (expr instanceof CombinatorExpr) {
        const args = expr.args.map(a => resolveTypeExpr(a, env));
        return new CombinatorExpr(expr.name, args);
    }
    return expr;
}

function parseExpr(
    slice: Slice,
    expr: CondExpr | TypeExpr,
    program: Program,
    env: Record<string, TypeExpr>,
): any {
    if (expr instanceof CellRefExpr) {
        const ref = slice.loadRef();
        return parseExpr(ref.beginParse(), expr.expr, program, env);
    }
    if (expr instanceof BuiltinOneArgExpr) {
        if (expr.name === '##' && expr.arg instanceof NumberExpr) {
            return slice.loadBits(expr.arg.num).toString();
        }
    }
    if (expr instanceof CombinatorExpr) {
        const args = expr.args.map(a => resolveTypeExpr(a, env));
        return parseByType(slice, expr.name, program, args, env);
    }
    if (expr instanceof NameExpr) {
        const n = expr.name;
        if (env[n]) {
            return parseExpr(slice, env[n], program, env);
        }
        if (n.startsWith('int')) {
            const b = parseInt(n.slice(3), 10);
            if (!isNaN(b)) return slice.loadIntBig(b);
        }
        if (n.startsWith('uint')) {
            const b = parseInt(n.slice(4), 10);
            if (!isNaN(b)) return slice.loadUintBig(b);
        }
        if (n.startsWith('bits')) {
            const b = parseInt(n.slice(4), 10);
            if (!isNaN(b)) return slice.loadBits(b).toString();
        }
        if (n === 'Bool') {
            return slice.loadBit();
        }
        return parseByType(slice, n, program, [], env);
    }
    throw new Error('Unsupported expression');
}
