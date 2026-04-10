// this is a light K6 test, in case you clone the repo
// and would like to test these endpoints
// "k6 run examples/k6.ts"

import http from "k6/http"
import type {Options} from "k6/options"
var data = new ArrayBuffer(1024*1024)
export const options: Options = {
  duration: "10s",
  vus: 10
}
export default function () {
  http.post("http://localhost:3000/", data);
}
