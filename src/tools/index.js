import { ASPECT_RATIOS, IMAGE_MODELS, VIDEO_ASPECT_RATIOS, VIDEO_MODELS } from '../flow.js';

export const toolDefinitions = [
  {
    name: 'generate_image',
    description:
      'Generate an image using Google Labs Flow (Nano Banana 2/Pro or Imagen 4). ' +
      'Returns absolute file paths to the saved images, plus the projectId for reuse in subsequent calls. ' +
      'Requires an active Google session (run `npx flow-api login` once first to authenticate).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text prompt describing the image to generate.',
        },
        model: {
          type: 'string',
          enum: IMAGE_MODELS.map((m) => m.id),
          description: 'Image model id. Defaults to "nano-banana-2" if omitted.',
          default: 'nano-banana-2',
        },
        aspect_ratio: {
          type: 'string',
          enum: ASPECT_RATIOS,
          description: 'Aspect ratio. Defaults to whatever Flow selects if omitted.',
        },
        output_dir: {
          type: 'string',
          description: 'Override output directory for this generation.',
        },
        project_id: {
          type: 'string',
          description:
            'Reuse an existing Flow project (UUID). Skip to create a new project every call. ' +
            'Pass the projectId returned by a previous generate_image call to keep all images in one project.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_video',
    description:
      'Generate a short cinematic video storyboard using Google Labs Flow. ' +
      'Under the hood Flow uses an agent (Omni Flash / Veo) to plan scenes and render each one as a separate MP4. ' +
      'This is a multi-step process: prompt → agent plan → confirmation → 1-5 min per scene. ' +
      'Total turnaround is typically 3-15 minutes depending on the number of scenes. ' +
      'Returns absolute file paths to the saved .mp4 files. Requires an active Google session ' +
      'and Google AI Pro / Ultra plan (free tier is image-only).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Text prompt describing the video story. The Flow agent will break it into 2-6 scenes and ' +
            'generate a separate short video for each. Be specific (subject, action, mood, lighting, camera).',
        },
        aspect_ratio: {
          type: 'string',
          enum: VIDEO_ASPECT_RATIOS,
          default: '16:9',
          description: 'Aspect ratio for the videos. "16:9" is landscape, "9:16" is vertical (shorts).',
        },
        count: {
          type: 'integer',
          enum: [1, 2, 3, 4],
          default: 1,
          description:
            'How many videos to generate per scene (Flow supports 1x-4x). Higher count = more credits.',
        },
        output_dir: {
          type: 'string',
          description: 'Override output directory for this generation.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'flow_status',
    description:
      'Check whether the Google Flow session is valid and the browser is ready. ' +
      'Returns { loggedIn, url, reason, uptimeSec, models, aspectRatios, videoModels, videoAspectRatios }.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'flow_login',
    description:
      'Open a visible Chromium window so the user can sign in to Google. ' +
      'After signing in, the session is persisted in the local Chrome profile for future calls. ' +
      'This is a one-time setup step. Closes the browser window when finished.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_sec: {
          type: 'integer',
          description: 'Max seconds to wait for the user to finish login. Default 300.',
          default: 300,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'flow_close',
    description: 'Close the browser. Useful for freeing memory or resetting state.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

export function textResult(text, isError = false) {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

export function jsonResult(obj) {
  return textResult(JSON.stringify(obj, null, 2));
}
