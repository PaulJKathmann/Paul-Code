import { editFile, grepSearch, globFind, listDirectory, runBash, writeToFile, readFile } from "../tools";

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message);
}

const TMP_DIR = ".tmp_tools_test";
const TMP_FILE = `${TMP_DIR}/sample.txt`;

// setup
runBash(`rm -rf ${TMP_DIR} && mkdir -p ${TMP_DIR}`);
writeToFile(TMP_FILE, "hello\nworld\n");

// read/write
assert(readFile(TMP_FILE).includes("hello"), "readFile should read file contents");

// edit_file
const editRes = editFile(TMP_FILE, "world", "there");
assert(editRes.includes("Successfully"), "editFile should succeed");
assert(readFile(TMP_FILE).includes("there"), "editFile should replace content");

// list_directory
const lsRes = listDirectory(TMP_DIR);
assert(lsRes.includes("sample.txt"), "listDirectory should list files");

// glob_find
const globRes = globFind("**/*.txt", TMP_DIR);
assert(globRes.includes("sample.txt"), "globFind should find txt file");

// grep_search
const grepRes = grepSearch("there", TMP_DIR);
assert(grepRes.includes("sample.txt") || grepRes.includes("there"), "grepSearch should find pattern");

// bash timeout
const timeoutRes = runBash("node -e \"setTimeout(()=>{}, 100000)\"", 200);
assert(timeoutRes.toLowerCase().includes("timed out"), "runBash should time out long commands");

// cleanup
runBash(`rm -rf ${TMP_DIR}`);

console.log("tools smoke test: OK");
