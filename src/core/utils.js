export function toHex32(v) {
    return "0x" + (v >>> 0).toString(16).padStart(8, "0");
}

export function signExtend(value, bits) {
    const shift = 32 - bits;
    return (value << shift) >> shift;
}
