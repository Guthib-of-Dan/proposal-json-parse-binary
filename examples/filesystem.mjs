// quite niche use-case, but still possible

import {readFile} from "node:fs/promises"
import "./polyfill.mjs"

var jsonA = await readFile("./package.json")

var packageJSON = JSON.parseBinary(jsonA)

// clear unused memory 
jsonA.buffer.detach()

console.log("is there valid package.json in working directory?", packageJSON.ok)
if (packageJSON.ok) {
  console.log("Here are the development dependencies", packageJSON.value.devDependencies)
} else {
  console.log("package.json has syntax errors: ", packageJSON.message);
}
