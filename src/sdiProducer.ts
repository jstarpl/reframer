import {
	bmdAudioSampleRate48kHz,
	bmdAudioSampleType16bitInteger,
	bmdFormat8BitYUV,
	bmdModeHD1080i50,
	capture,
	CaptureFrame,
} from 'macadam'
import { Valve, isValue, end, Generator } from 'redioactive'
import * as beamcoder from 'beamcoder-prebuild'
import { filterer } from 'beamcoder-prebuild'
import { endTrace, startTrace } from './trace'

// capture on decklink 1
const captureChannel = capture({
	deviceIndex: 0,
	channels: 2,
	sampleRate: bmdAudioSampleRate48kHz,
	sampleType: bmdAudioSampleType16bitInteger,
	displayMode: bmdModeHD1080i50,
	pixelFormat: bmdFormat8BitYUV,
})

export const provideFrame: Generator<CaptureFrame> = async () => {
	const t = startTrace('SDI capture')
	const frame = await (await captureChannel).frame()
	endTrace(t)

	if (frame.video.width !== 1920 || frame.video.height !== 1080) {
		throw new Error('Unexpected capture frame size')
	}

	return frame
}

const vidFilterer = filterer({
	filterType: 'video',
	inputParams: [
		{
			timeBase: [1, 1000],
			width: 1920,
			height: 1080,
			pixelFormat: 'uyvy422',
			pixelAspect: [1, 1],
		},
	],
	outputParams: [
		{
			pixelFormat: 'bgra',
		},
	],
	filterSpec: `fps=25`,
})

export const sdiFrameToFFmpegFrame: Valve<CaptureFrame, beamcoder.Frame> = async (frame) => {
	if (isValue(frame)) {
		const data = Buffer.alloc(frame.video.rowBytes * frame.video.height)
		frame.video.data.copy(data)

		const beamFrame = beamcoder.frame({
			linesize: [frame.video.rowBytes],
			width: frame.video.width,
			height: frame.video.height,
			sampleAspectRatio: [1, 1],
			data: [data],
			format: 'uyvy422',
			// pts: frameNo++ * 1000,
			pts: frame.video.frameTime,
			// interlaced_frame: true,
			// top_field_first: true,
		})

		const t = startTrace('Filter uyvy -> rgba')
		const filtered = await (await vidFilterer).filter([beamFrame])
		endTrace(t)

		const filteredFrame = filtered[0].frames[0]
		if (!filteredFrame) {
			console.log('skip')
			return beamcoder.frame({
				linesize: [frame.video.rowBytes],
				width: frame.video.width,
				height: frame.video.height,
				sampleAspectRatio: [1, 1],
				data: [Buffer.alloc(1920 * 1080 * 4).fill(0x00)],
				format: 'bgra',
			})
		}

		return filteredFrame
	} else {
		return end
	}
}

export const audioFork: Valve<CaptureFrame, CaptureFrame['audio']> = (frame) => {
	if (isValue(frame)) {
		return frame.audio
	} else {
		return frame
	}
}
