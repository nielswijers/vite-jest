import fs from 'fs'
import path from 'path'

import { parse } from 'es-module-lexer'
import MagicString from 'magic-string'

import viteServer from './vite-server.js'
import {
  slashOnWindows,

  FS_PREFIX,
  fsPathFromId,
  
  isVirtualFileRequest,
  virtualPathToFsPath
} from './pathUtils.js'

async function processAsync(src, filepath) {
  let result = await viteServer.transformRequest(filepath)

  // not sure if this is reliable
  if (viteServer._pendingReload) {
    await viteServer._pendingReload
    result = await viteServer.transformRequest(filepath)
  }

  if (!result) {
    throw new Error(`Failed to load module ${filepath}`)
  }

  // The following logic is better to be placed in an async jest resolver
  const mStr = new MagicString(result.code)
  const [imports] = await parse(result.code)
  for (let index = 0; index < imports.length; index++) {
    let {
      s: start,
      e: end,
      ss: expStart,
      d: dynamicIndex,
      n: url
    } = imports[index]

    if (!url) {
      // will this really happen?
      continue
    }
    
    // when parsing dynamic imports, the starting and ending quotes are also included
    // note here we don't care about the case where the url is a variable
    // because Vite doesn't allow fully-dynamic imports.
    // They must be a string.
    if (dynamicIndex > -1) {
      start += 1
      end -= 1
    }

    if (url.startsWith(FS_PREFIX)) {
      mStr.overwrite(
        start,
        end,
        `./${path.relative(path.dirname(filepath), fsPathFromId(url))}`
      )
      continue
    }
    
    if (isVirtualFileRequest(url)) {
      const virtualFilePath = virtualPathToFsPath(url)

      if (!fs.existsSync(virtualFilePath)) {
        const { code } = await viteServer.transformRequest(url.replace(/^\/@id\//, ''))
        fs.writeFileSync(virtualFilePath, code)
      }

      mStr.overwrite(
        start,
        end,
        `./${path.relative(path.dirname(filepath), virtualFilePath)}`
      )
      continue
    }
    
    if (url.startsWith('/')) {
      const projectFilePath = slashOnWindows(path.join(viteServer.config.root, url))
      const relativePath = `./${path.relative(path.dirname(filepath), projectFilePath)}`

      mStr.overwrite(
        start,
        end,
        relativePath
      )
      continue
    }
  }

  return {
    code: mStr.toString(),
    // TODO: use `@cush/sorcery` to merge source map of the magic string
    map: result.map
  }
}

export default {
  processAsync,

  // It is necessary because we use vite-jest to tranform everything,
  // we'll inevitably encounter some CommonJS modules.
  process: src => src
}
