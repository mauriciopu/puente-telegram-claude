# transcribir.py — pasa un audio a texto, en local.
# Uso: python transcribir.py audio.oga [modelo]
#
# Requiere:  pip install faster-whisper
# El audio no sale de tu máquina. La primera vez descarga el modelo
# (unos 1,5 GB con "medium"); si tu máquina sufre, usa "small".
import sys


def main():
    ruta = sys.argv[1]
    modelo = sys.argv[2] if len(sys.argv) > 2 else "medium"
    from faster_whisper import WhisperModel
    m = WhisperModel(modelo, device="cpu", compute_type="int8")
    segmentos, _ = m.transcribe(
        ruta,
        language="es",
        beam_size=5,
        initial_prompt="Nota de voz informal en español venezolano y colombiano.",
        vad_filter=True,
    )
    print(" ".join(s.text.strip() for s in segmentos))


if __name__ == "__main__":
    main()
