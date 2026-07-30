"""RunPod Flash GPU endpoint: Qwen2.5-VL iPhone defect detection."""
from runpod_flash import Endpoint, GpuGroup

vision = Endpoint(
    name="fbm-vision",
    gpu=GpuGroup.ADA_24,
    workers=(0, 2),
    dependencies=["torch", "transformers", "accelerate", "qwen-vl-utils", "pillow", "requests"],
)

_MODEL_CACHE = {}


def _infer(image_url: str, prompt: str) -> str:
    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor
    from qwen_vl_utils import process_vision_info

    if "model" not in _MODEL_CACHE:
        name = "Qwen/Qwen2.5-VL-7B-Instruct"
        _MODEL_CACHE["model"] = AutoModelForImageTextToText.from_pretrained(
            name, torch_dtype=torch.bfloat16, device_map="auto"
        )
        _MODEL_CACHE["processor"] = AutoProcessor.from_pretrained(name)
    model = _MODEL_CACHE["model"]
    processor = _MODEL_CACHE["processor"]

    messages = [{"role": "user", "content": [
        {"type": "image", "image": image_url},
        {"type": "text", "text": prompt},
    ]}]
    chat = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = processor(text=[chat], images=image_inputs, videos=video_inputs,
                       padding=True, return_tensors="pt").to(model.device)
    generated = model.generate(**inputs, max_new_tokens=512)
    trimmed = [out[len(inp):] for inp, out in zip(inputs.input_ids, generated)]
    return processor.batch_decode(trimmed, skip_special_tokens=True)[0]


@vision.post("/defects")
async def defects(data: dict):
    from runpod.lib.defects import build_defect_prompt, parse_defect_response
    from runpod.lib.schema import to_jsonable, ImageDefectReport

    prompt = build_defect_prompt()
    reports = []
    for url in (data.get("image_urls") or []):
        try:
            report = parse_defect_response(_infer(url, prompt), url)
            if report.error == "unparseable":  # one structured-repair retry
                retry_prompt = prompt + "\nReturn ONLY valid json, nothing else."
                report = parse_defect_response(_infer(url, retry_prompt), url)
                if report.error == "unparseable":
                    report.error = "unparseable_after_retry"
        except Exception as exc:  # bad/unreachable image -> per-image error, continue
            report = ImageDefectReport(image_url=url, condition_grade="unknown",
                                       negotiation_summary="", error=str(exc)[:200])
        reports.append(to_jsonable(report))
    return {"reports": reports}
