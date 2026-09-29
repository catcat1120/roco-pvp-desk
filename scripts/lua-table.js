// 解析 BWIKI 数据模块里的 Lua 表（`return {...}`）。只支持数据表用到的子集：
// 表、字符串、数字、布尔、nil、注释；不执行任何代码。
function parseLuaTable(source) {
  let i = 0;
  const fail = (message) => { throw new Error(`Lua 解析失败（位置 ${i}）：${message}`); };

  function skip() {
    for (;;) {
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source.startsWith('--', i)) {
        const long = /^--\[(=*)\[/.exec(source.slice(i, i + 20));
        if (long) {
          const end = source.indexOf(`]${long[1]}]`, i);
          i = end < 0 ? source.length : end + long[1].length + 2;
        } else {
          while (i < source.length && source[i] !== '\n') i++;
        }
      } else return;
    }
  }

  function string() {
    const quote = source[i++];
    let out = '';
    while (i < source.length && source[i] !== quote) {
      if (source[i] === '\\') {
        const next = source[++i];
        if (next === 'n') out += '\n';
        else if (next === 't') out += '\t';
        else if (next === 'r') out += '\r';
        else if (/\d/.test(next)) {
          const digits = /^\d{1,3}/.exec(source.slice(i))[0];
          out += String.fromCharCode(Number(digits)); i += digits.length - 1;
        } else out += next;
        i++;
      } else out += source[i++];
    }
    if (source[i] !== quote) fail('字符串未闭合');
    i++;
    return out;
  }

  function longString() {
    const open = /^\[(=*)\[/.exec(source.slice(i, i + 20));
    const end = source.indexOf(`]${open[1]}]`, i);
    if (end < 0) fail('长字符串未闭合');
    const body = source.slice(i + open[0].length, end);
    i = end + open[1].length + 2;
    return body.replace(/^\n/, '');
  }

  function value() {
    skip();
    const c = source[i];
    if (c === '{') return table();
    if (c === '"' || c === "'") return string();
    if (c === '[' && /^\[=*\[/.test(source.slice(i, i + 20))) return longString();
    const number = /^-?(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/.exec(source.slice(i));
    if (number) { i += number[0].length; return Number(number[0]); }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (word) {
      i += word[0].length;
      if (word[0] === 'true') return true;
      if (word[0] === 'false') return false;
      if (word[0] === 'nil') return null;
    }
    return fail(`无法识别的值 ${JSON.stringify(source.slice(i, i + 12))}`);
  }

  function table() {
    i++; // {
    const object = {};
    const array = [];
    for (;;) {
      skip();
      if (source[i] === '}') { i++; break; }
      let key = null;
      if (source[i] === '[' && !/^\[=*\[/.test(source.slice(i, i + 20))) {
        i++; key = value(); skip();
        if (source[i] !== ']') fail('缺少 ]');
        i++; skip();
        if (source[i] !== '=') fail('缺少 =');
        i++;
      } else {
        const name = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(source.slice(i));
        if (name) { key = name[1]; i += name[0].length; }
      }
      const item = value();
      if (key === null) array.push(item); else object[key] = item;
      skip();
      if (source[i] === ',' || source[i] === ';') i++;
    }
    return array.length && !Object.keys(object).length ? array : Object.assign(object, array.length ? { _list: array } : {});
  }

  skip();
  const ret = /^return\b/.exec(source.slice(i));
  if (ret) i += ret[0].length;
  const result = value();
  skip();
  return result;
}

module.exports = { parseLuaTable };
