# MZ loader for SEL.EXE / PSI5.EXE (MS-C 1.04 small model: code at image 0, DGROUP at paragraph `ds`).
import struct, pathlib
GAME = pathlib.Path(__file__).resolve().parent.parent
class MZ:
    def __init__(self, name):
        d = (GAME / name).read_bytes()
        h = struct.unpack('<14H', d[:28])
        size = (h[2] - 1) * 512 + (h[1] or 512)
        self.img = d[h[4] * 16:size]
        self.ds = struct.unpack('<H', self.img[0x10:0x12])[0]   # mov ax,DGROUP at 000f
        self.code = self.img[:self.ds * 16]
        self.data = self.img[self.ds * 16:]
    def w(self, off): return struct.unpack('<H', self.data[off:off + 2])[0]
    def cstr(self, off):
        e = self.data.index(b'\0', off); return self.data[off:e]
