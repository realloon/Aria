import type { JsonObject } from '../types/tools.js'
import { isAbsolute, resolve } from 'node:path'

export function parseArgs(argsJson: string) {
  const parsed = JSON.parse(argsJson || '{}')

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object.')
  }

  return parsed as JsonObject
}

export function getString(args: JsonObject, key: string) {
  const value = args[key]

  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string.`)
  }

  return value
}

export function getOptionalBoolean(args: JsonObject, key: string) {
  const value = args[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean.`)
  }

  return value
}

export function getOptionalNumber(args: JsonObject, key: string) {
  const value = args[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number.`)
  }

  return value
}

export function getOptionalStringArray(args: JsonObject, key: string) {
  const value = args[key]

  if (value === undefined) {
    return undefined
  }

  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${key} must be an array of strings.`)
  }

  return value as string[]
}

export function resolvePath(cwd: string, targetPath: string) {
  return isAbsolute(targetPath) ? resolve(targetPath) : resolve(cwd, targetPath)
}
