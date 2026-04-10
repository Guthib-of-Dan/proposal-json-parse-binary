// this is a light K6 test, in case you clone the repo
// and would like to test these endpoints
// "k6 run examples/k6.ts"

import http from "k6/http"
import type {Options} from "k6/options"

var data = JSON.stringify(new Array(10000).fill({txt1: "LARGE STRING !!!!!!!!!!!!!", id: 100000, nestedObj: {data: "STRING!!!!!!!"}}));
console.log("payload size", data.length)
export const options: Options = {
  duration: "10s",
  vus: 10
}
export default function () {
  http.post("http://localhost:3000/", data);
}
