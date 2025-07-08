<template>
  <div class="container">
    <h1>TLB Reader</h1>
    <form>
      <div class="field">
        <label for="tlb">TLB Definitions:</label>
        <textarea id="tlb" v-model="tlbText" rows="8" />
      </div>
      <div class="field">
        <label for="root">Root Type:</label>
        <input id="root" v-model="rootName" />
      </div>
      <div class="field">
        <label for="boc">BOC (base64 or hex):</label>
        <textarea id="boc" v-model="bocText" rows="5" />
      </div>
      <button @click.prevent="parse">Parse</button>
    </form>
    <div v-if="parseError" class="error">{{ parseError }}</div>
    <div v-if="result">
      <h2>Result</h2>
      <pre>{{ result }}</pre>
    </div>
    <div v-if="errors">
      <h2>Errors</h2>
      <pre>{{ errors }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { parseTLB, tryParseCell } from 'tlb-reader'
import { Cell, Slice } from '@ton/core'
import { ref } from 'vue'

const tlbText = ref('')
const rootName = ref('')
const bocText = ref('')
const result = ref<string | null>(null)
const errors = ref<string | null>(null)
const parseError = ref<string | null>(null)

function parse() {
  parseError.value = null
  result.value = null
  errors.value = null
  try {
    const program = parseTLB(tlbText.value)
    const boc = decodeBoc(bocText.value)
    const cell = Cell.fromBoc(boc)[0]
    const parsed = tryParseCell(cell, program, rootName.value)
    result.value = JSON.stringify(parsed.result, jsonReplacer, 2)
    if (parsed.errors) {
      errors.value = JSON.stringify(parsed.errors, jsonReplacer, 2)
    }
  } catch (e: any) {
    parseError.value = e.message || String(e)
  }
}

function decodeBoc(text: string): Buffer {
  const t = text.trim()
  if (/^[0-9a-fA-F]+$/.test(t)) {
    return Buffer.from(t, 'hex')
  }
  return Buffer.from(t, 'base64')
}

function jsonReplacer(_key: string, value: any) {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (value instanceof Cell || value instanceof Slice) {
    return value.toString()
  }
  return value
}
</script>

<style>
.container {
  max-width: 800px;
  margin: auto;
  padding: 20px;
}
.field {
  margin-bottom: 1em;
}
textarea {
  width: 100%;
}
pre {
  background: #f3f3f3;
  padding: 10px;
  overflow-x: auto;
}
.error {
  color: red;
}
</style>
