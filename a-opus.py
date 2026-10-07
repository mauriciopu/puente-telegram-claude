# a-opus.py — MP3 a OGG/Opus. Imprime la duración en segundos.
# Uso: python a-opus.py entrada.mp3 salida.ogg
#
# Telegram solo acepta OGG/Opus en sendVoice, y edge-tts entrega MP3.
# PyAV trae libopus incorporado, así que no hace falta instalar ffmpeg.
import sys
import av

SR = 48000  # Opus trabaja a 48 kHz


def convertir(entrada, salida):
    with av.open(entrada) as origen:
        pista = next((s for s in origen.streams if s.type == "audio"), None)
        if pista is None:
            raise ValueError("el archivo no tiene pista de audio")

        with av.open(salida, "w", format="ogg") as destino:
            # El layout va en el STREAM. Si solo remuestreas a mono, el
            # encoder sigue en estéreo y duplica el peso sin avisar.
            out = destino.add_stream("libopus", rate=SR, layout="mono")
            out.bit_rate = 32000  # de sobra para voz
            rs = av.AudioResampler(format="s16", layout="mono", rate=SR)

            muestras = 0
            for cuadro in origen.decode(pista):
                for r in rs.resample(cuadro):
                    muestras += r.samples
                    for p in out.encode(r):
                        destino.mux(p)
            for r in rs.resample(None):        # vaciar el resampler
                muestras += r.samples
                for p in out.encode(r):
                    destino.mux(p)
            for p in out.encode(None):         # vaciar el encoder
                destino.mux(p)

    return max(1, round(muestras / SR))


if __name__ == "__main__":
    print(convertir(sys.argv[1], sys.argv[2]))
