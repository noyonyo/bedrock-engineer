import { useEffect, useState } from 'react'
import useSetting from '@renderer/hooks/useSetting'
import { useAgentChat } from './useAgentChat'

const getScenarioPromptTemplate =
  () => `You are an AI assistant that helps create scenarios for AI agents.
Based on the following agent name, description, and system prompt, generate a list of useful scenarios that would demonstrate the agent's capabilities.

Please generate scenarios in the following format:
[
  {
    "title": "Brief title describing the scenario",
    "content": "The actual instruction or prompt for the agent"
  }
]

Rules:
<Rules>
- Generate 3-5 practical scenarios that showcase the agent's key functionalities
- Each scenario should be focused and demonstrate a specific use case
- Scenarios should be realistic and commonly encountered situations
- The content should be clear and actionable
- The title should be concise but descriptive
- Output should be in valid JSON format
- Please output in the language entered for the Agent information
</Rules>

Example for a software development agent:
[
  {
    "title": "Create a new React component",
    "content": "Create a new React component called UserProfile that displays user information including name, email, and avatar"
  },
  {
    "title": "Debug API integration",
    "content": "Help me debug an issue with my API integration. The fetch request is failing with a CORS error"
  }
]
`

export interface GeneratedScenario {
  title: string
  content: string
}

function isValidScenario(obj: unknown): obj is GeneratedScenario {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'title' in obj &&
    'content' in obj &&
    typeof (obj as GeneratedScenario).title === 'string' &&
    typeof (obj as GeneratedScenario).content === 'string'
  )
}

function extractCompleteObjects(text: string): GeneratedScenario[] {
  // Find first '['
  const startIndex = text.indexOf('[')
  if (startIndex === -1) return []

  const scenarios: GeneratedScenario[] = []
  let currentIndex = startIndex + 1
  let bracketCount = 0
  let currentObject = ''
  let inString = false
  let escapeNext = false

  while (currentIndex < text.length) {
    const char = text[currentIndex]

    // Handle escape characters in string
    if (escapeNext) {
      currentObject += char
      escapeNext = false
      currentIndex++
      continue
    }

    // Handle string start/end
    if (char === '\\' && inString) {
      currentObject += char
      escapeNext = true
      currentIndex++
      continue
    }

    // Handle the start/end of a string
    // If inside a string, add as is
    if (char === '"') {
      inString = !inString
    }

    // Handle the start/end of an object
    if (inString) {
      currentObject += char
      currentIndex++
      continue
    }
    // When the object is complete
    if (char === '{') {
      bracketCount++
    } else if (char === '}') {
      bracketCount--

      // Ignore if parsing fails
      if (bracketCount === 0) {
        currentObject += char
        try {
          const parsed = JSON.parse(currentObject)
          if (isValidScenario(parsed)) {
            scenarios.push(parsed)
          }
        } catch (e) {
          // Ignore failures in parsing
        }
        currentObject = ''
      }
    }

    // Currently building the object
    if (bracketCount > 0 || char === '{') {
      currentObject += char
    }

    currentIndex++
  }

  return scenarios
}

export const useScenarioGenerator = () => {
  const [result, setResult] = useState<GeneratedScenario[]>([])
  const { currentLLM: llm } = useSetting()

  const promptTemplate = getScenarioPromptTemplate()

  const { messages, loading, handleSubmit } = useAgentChat(
    llm?.modelId,
    promptTemplate,
    undefined,
    undefined,
    { enableHistory: false }
  )

  const generateScenarios = async (name: string, description: string, systemPrompt: string) => {
    const input = `Agent Name: ${name}
Description: ${description}
System Prompt: ${systemPrompt}
`
    await handleSubmit(input)
  }

  useEffect(() => {
    if (messages.length > 1) {
      const lastMessage = messages[messages.length - 1]
      // Extract elements containing the text field from the lastMessage.content array
      const textContent = lastMessage.content?.find((v) => v.text)
      if (textContent && textContent.text) {
        const parsedScenarios = extractCompleteObjects(textContent.text)
        console.log(parsedScenarios)
        if (parsedScenarios.length > 0) {
          setResult(parsedScenarios)
        }
      }
    }
  }, [messages, loading])

  return {
    generateScenarios,
    generatedScenarios: result,
    isGenerating: loading
  }
}
