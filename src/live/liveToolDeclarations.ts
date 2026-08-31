/**
 * FRIDAY AI — Gemini Live Tool Declarations (100% Unique & Verified)
 * Declarations defining parameters and capabilities for real-time voice streaming.
 */

export const fridayFunctionDeclarations: any[] = [
  {
    "name": "start_background_task",
    "description": "Start a background task (e.g. weather update, live cricket score check, product deal search, security scan, codebase audit, or custom background operation). Friday immediately acknowledges in conversation that the task has started in background, and when it finishes, it will be reported at the end of a turn or when DK asks.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "taskName": {
          "type": "STRING",
          "description": "Clear name of the background task, e.g. 'Weather Update for Patna', 'Live Cricket Match Score', 'Godrej Fridge Price Search'"
        },
        "taskType": {
          "type": "STRING",
          "description": "Type/category: 'weather', 'cricket', 'deals', 'security_scan', 'wifi_scan', 'code_fix', or 'custom'"
        },
        "targetOrQuery": {
          "type": "STRING",
          "description": "Target city, query, product, or topic (e.g. 'Patna', 'India match', 'shoes')"
        },
        "description": {
          "type": "STRING",
          "description": "Short description of what is being processed in background"
        }
      },
      "required": [
        "taskName",
        "taskType"
      ]
    }
  },
  {
    "name": "get_background_tasks_status",
    "description": "Check the live status of all running, active, and completed background tasks. Use when DK asks 'Background me kya chal raha hai?', 'Kya kar rahi ho background me?', 'Weather update hua kya?', 'Update kiya kya hua batao?', or 'Jo kaam bola tha uska kya hua?'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Optional filter for a specific task or topic, e.g. 'weather', 'cricket', 'deals'"
        }
      },
      "required": []
    }
  },
  {
    "name": "mark_background_task_notified",
    "description": "Mark a completed background task as notified after informing DK about its outcome/result in conversation.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "taskId": {
          "type": "STRING",
          "description": "ID of the completed task, or 'all' to mark all completed tasks as notified"
        }
      },
      "required": [
        "taskId"
      ]
    }
  },
  {
    "name": "cancel_background_task",
    "description": "Cancel a currently running background task if DK asks to cancel, stop, or abort it.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "taskIdOrName": {
          "type": "STRING",
          "description": "ID or name of the background task to cancel"
        }
      },
      "required": [
        "taskIdOrName"
      ]
    }
  },
  {
    "name": "request_code_change",
    "description": "Use when DK asks for a code/feature change or to fix a bug in his app/project (e.g. 'ye feature add karo', 'ye bug fix karo', 'code me change karo'). Sends the instruction to Friday's coding agent, which will analyze the repo and come back with a plan for DK to approve — this does NOT make any change itself.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "instruction": {
          "type": "STRING",
          "description": "DK's exact instruction/request for the code change, as literally as possible"
        }
      },
      "required": [
        "instruction"
      ]
    }
  },
  {
    "name": "remember_personal_fact",
    "description": "Save an important personal fact about DK to permanent memory IMMEDIATELY, the moment DK states it — do not wait for the conversation to end. Use for anything about DK's life: family members, identity details, career/business, residence/lifestyle, secrets, or any other concrete personal detail. Also use whenever DK explicitly says to remember something ('yaad rakhna', 'yaad rakho', 'don't forget').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "factText": {
          "type": "STRING",
          "description": "The EXACT fact as DK stated it, literal and unaltered — do not summarize or paraphrase."
        },
        "category": {
          "type": "STRING",
          "description": "One of: boss_identity, family_members, personal_secrets_and_facts, career_and_business, residence_and_lifestyle, general_personal_info. Use general_personal_info if nothing else fits — never skip saving just because of category."
        }
      },
      "required": [
        "factText"
      ]
    }
  },
  {
    "name": "add_custom_skill_or_rule",
    "description": "Add a new permanent rule, capability, habit, or behavioral instruction to Friday's brain when DK instructs to add or learn something new.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "skillName": {
          "type": "STRING",
          "description": "Short title or name of the new skill or rule"
        },
        "ruleInstruction": {
          "type": "STRING",
          "description": "The exact behavioral rule or action Friday must follow"
        },
        "triggerPhrase": {
          "type": "STRING",
          "description": "Optional trigger word or situation when this rule applies"
        }
      },
      "required": [
        "skillName",
        "ruleInstruction"
      ]
    }
  },
  {
    "name": "save_contact",
    "description": "Save a new person or contact to DK's contacts book with their name, phone number, and optional relationship.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "contactName": {
          "type": "STRING",
          "description": "Name of the person (e.g. 'Rahul', 'Aman', 'Priya')"
        },
        "phoneNumber": {
          "type": "STRING",
          "description": "Phone number (e.g. '9876543210' or '919876543210')"
        },
        "relation": {
          "type": "STRING",
          "description": "Optional relationship (e.g. 'Friend', 'Brother', 'Colleague', 'Mummy')"
        }
      },
      "required": [
        "contactName",
        "phoneNumber"
      ]
    }
  },
  {
    "name": "delete_contact",
    "description": "Delete/remove a person from DK's contacts book by name or phone number. Use when DK says to delete, remove, or forget a saved contact (e.g. 'Rahul ka contact delete karo', 'is number ko hata do').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "contactNameOrPhone": {
          "type": "STRING",
          "description": "The name of the contact to delete (e.g. 'Rahul') or their phone number"
        }
      },
      "required": [
        "contactNameOrPhone"
      ]
    }
  },
  {
    "name": "send_whatsapp_to_contact",
    "description": "Send a WhatsApp message directly to any contact (e.g. Rahul, Aman, Mummy) in the background using Friday's dedicated assistant session.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "contactNameOrPhone": {
          "type": "STRING",
          "description": "The name of the contact in the phonebook (e.g. 'Rahul') or raw phone number"
        },
        "messageText": {
          "type": "STRING",
          "description": "The exact message to send to the contact"
        }
      },
      "required": [
        "contactNameOrPhone",
        "messageText"
      ]
    }
  },
  {
    "name": "pair_dedicated_whatsapp_number",
    "description": "Request an 8-character Pairing Code to link DK's spare phone number to Friday's dedicated WhatsApp bot.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "phoneNumber": {
          "type": "STRING",
          "description": "The 10 or 12 digit phone number to pair (e.g. '9876543210')"
        }
      },
      "required": [
        "phoneNumber"
      ]
    }
  },
  {
    "name": "set_reminder",
    "description": "Set a reminder or alarm for DK with a specific message and time duration or timestamp.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "title": {
          "type": "STRING",
          "description": "Reminder task or subject"
        },
        "timeString": {
          "type": "STRING",
          "description": "When to remind, e.g., 'in 10 minutes', 'tomorrow at 9am'"
        },
        "durationMinutes": {
          "type": "NUMBER",
          "description": "Duration in minutes if relative, otherwise 0"
        }
      },
      "required": [
        "title"
      ]
    }
  },
  {
    "name": "save_quick_note",
    "description": "Save a note, idea, or todo item in DK's persistent notebook.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "title": {
          "type": "STRING",
          "description": "Note title"
        },
        "content": {
          "type": "STRING",
          "description": "Exact note text or todo item"
        }
      },
      "required": [
        "title",
        "content"
      ]
    }
  },
  {
    "name": "get_whatsapp_messages",
    "description": "Read WhatsApp messages received on Friday's linked number. Use whenever DK asks ANYTHING about his WhatsApp activity — messages, notifications, notifs, updates, or alerts, whether about a specific person, a group, a specific time, or just generally 'is there anything new'. Treat 'message', 'msg', and 'notification' as interchangeable words meaning the same thing here — e.g. 'koi message hai?', 'whatsapp ki notification batao', 'Rahul ne kya likha?', '5 din pehle kya msg tha?'. Can filter by personal/group, sender name, group name, and date.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "messageType": {
          "type": "STRING",
          "description": "Type: 'personal' for 1-on-1 chats, 'group' for group chats, 'all' for both."
        },
        "senderName": {
          "type": "STRING",
          "description": "Filter by sender name, e.g. 'Rahul'. Optional."
        },
        "groupName": {
          "type": "STRING",
          "description": "Filter by group name, e.g. 'Family Group'. Optional."
        },
        "dateFilter": {
          "type": "STRING",
          "description": "Date: 'aaj', 'kal', '5 din pehle', 'pichle hafte'. Blank = last 48 hours."
        },
        "limit": {
          "type": "NUMBER",
          "description": "Max messages to return. Default 10 personal, 5 group."
        }
      },
      "required": [
        "messageType"
      ]
    }
  },
  {
    "name": "get_whatsapp_latest_media",
    "description": "Inspect and describe what is inside the latest photo, PDF, document, video, or voice message received on WhatsApp. Use whenever DK asks 'photo me kya hai?', 'PDF/document me kya likha hai?', 'video me kya tha?', 'latest WhatsApp media check karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Optional specific question about the media, e.g. 'amount kitna hai', 'kiska photo hai', 'document ka title kya hai'"
        }
      },
      "required": []
    }
  },
  {
    "name": "set_whatsapp_reply_limit",
    "description": "Change how many automatic WhatsApp replies Friday is allowed to send a specific contact per day (resets every day). Use when DK says things like 'Priya ka reply limit 15 kar do', 'Rahul ka limit ghata ke 3 kar do', or asks to increase/decrease/change how many auto-replies someone can get per day. Default is 10 per day per contact if never set.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "contactNameOrPhone": {
          "type": "STRING",
          "description": "The contact's name (e.g. 'Priya') or phone number whose daily auto-reply limit should change."
        },
        "newLimit": {
          "type": "NUMBER",
          "description": "The new daily auto-reply limit for this contact (0 or more). 0 means Friday will never auto-reply to them."
        }
      },
      "required": [
        "contactNameOrPhone",
        "newLimit"
      ]
    }
  },
  {
    "name": "save_daily_update",
    "description": "Save/append something DK dictates as today's update, e.g. 'aaj ka update note karo, maine khana kha liya'. Use whenever DK asks you to note, save, log, or record today's update/status, in any phrasing. Multiple calls the same day all get appended together into one running log for today. This log is later used to answer people on WhatsApp who ask about DK (e.g. 'DK ne khana khaya?').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "updateText": {
          "type": "STRING",
          "description": "The exact update content DK dictated, e.g. 'maine khana kha liya' or 'gym gaya, ab office ja raha hoon'."
        }
      },
      "required": [
        "updateText"
      ]
    }
  },
  {
    "name": "get_daily_update",
    "description": "Recall what DK logged as his update for a given day. Use when DK asks things like 'aaj humne kya update likha tha', 'kal kya update tha', 'parso kya kiya tha', or 'X tarikh ko kya update tha'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "dateWord": {
          "type": "STRING",
          "description": "Which day, in DK's own words: 'aaj', 'kal', 'parso', '3 din pehle', etc. Default 'aaj' if not specified."
        }
      },
      "required": []
    }
  },
  {
    "name": "get_boss_daily_routine",
    "description": "Get Boss Divakar's (DK's) 24-hour daily life routine, timetable, and active habit slot based on Indian Standard Time. Use when DK asks 'Mera daily routine kya hai?', 'Mera schedule dikhao', 'Mera timetable batao', or to verify which activity is scheduled right now.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "update_boss_daily_routine",
    "description": "Update or customize Boss's daily habit schedule slot (e.g. gym time, lunch break, coding hours, evening walk). Use when DK says 'Mera gym ka time subah 7 baje kar do', 'Mera lunch 2 baje hota hai', 'Routine me dinner time change karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "slotQuery": {
          "type": "STRING",
          "description": "Which habit slot to update: 'gym', 'breakfast', 'coding', 'lunch', 'walk', 'dinner', or 'sleep'"
        },
        "startTimeStr": {
          "type": "STRING",
          "description": "New start time, e.g. '07:00 AM', '7:00 am', '14:00'"
        },
        "endTimeStr": {
          "type": "STRING",
          "description": "New end time, e.g. '08:30 AM', '8:30 am', '15:00'"
        },
        "activity": {
          "type": "STRING",
          "description": "Optional updated activity description"
        }
      },
      "required": [
        "slotQuery"
      ]
    }
  },
  {
    "name": "record_ai_self_correction",
    "description": "MANDATORY: Call IMMEDIATELY whenever Boss corrects Friday, scolds Friday for a wrong answer, points out a mistake ('Aisa nahi bolna chahiye tha', 'Tumne galat bola', 'Aage se yaad rakhna...', 'Mera matlab ye tha tum samjhi nahi'), or teaches Friday how she should have responded. Permanently stores the mistake, Boss's correction, and the golden rule for future conversations so Friday NEVER repeats the mistake.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "whatFridayDidWrong": {
          "type": "STRING",
          "description": "What Friday said or assumed that was wrong or robotic"
        },
        "whatBossTaught": {
          "type": "STRING",
          "description": "What Boss said, corrected, or instructed Friday to do instead"
        },
        "goldenRule": {
          "type": "STRING",
          "description": "The clear rule to follow in all future turns (e.g. 'Never say don't know, guess from gym habit')"
        },
        "triggerContext": {
          "type": "STRING",
          "description": "Optional context or topic, e.g. 'Daily routine', 'Music', 'Coding'"
        }
      },
      "required": [
        "whatFridayDidWrong",
        "whatBossTaught",
        "goldenRule"
      ]
    }
  },
  {
    "name": "get_ai_learned_lessons",
    "description": "Get the complete list of wisdom, corrections, and rules that Boss has taught Friday. Use when Boss asks 'Tumne mujhse kya seekha hai?', 'Mera diya hua rule dikhao', 'Galtiyan kya-kya note ki hain'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "search_long_term_vector_memory",
    "description": "Search Friday's permanent Vector Database using SOTA semantic AI embeddings. Retrieves conversations, decisions, daily updates, or project milestones from weeks, months, or years ago even if phrased differently. Supports exact date filtering with filterDate. Use when DK asks 'Humne pichle mahine kya discuss kiya tha?', 'Purani vector memory search karo', '25 August ko maine kya bola tha?'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "searchQuery": {
          "type": "STRING",
          "description": "The concept, topic, or question to search across lifetime memory"
        },
        "limit": {
          "type": "NUMBER",
          "description": "Maximum number of results to return (default 5)"
        },
        "filterDate": {
          "type": "STRING",
          "description": "Optional specific date or month to filter by (e.g. '2026-08-25', 'June 2026')"
        }
      },
      "required": [
        "searchQuery"
      ]
    }
  },
  {
    "name": "get_memory_lifecycle_status",
    "description": "Get the exact health and statistics of Friday's 4-tier memory lifecycle (last 4 days verbatim sessions count, 60-day deep summaries count, 30-day word-to-word daily updates count, and total permanent vector entries).",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "retrieve_smart_multi_tier_context",
    "description": "Intelligent Parallel 3-Tier Memory Fetcher: Given user utterance (e.g. 'wo purani dikkat phir se ho gayi', 'aaj office project me problem aayi'), concurrently searches Tier 1 (4-day chat), Tier 2 (30-day daily updates), and Tier 3 (Long-term Vector DB) to synthesize human context awareness of past, present, and future.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "utterance": {
          "type": "STRING",
          "description": "The sentence or problem spoken by Boss"
        }
      },
      "required": [
        "utterance"
      ]
    }
  },
  {
    "name": "get_current_time",
    "description": "MANDATORY Real-Time Live Clock: Get the exact current Indian Standard Time (IST), exact hour, minute, second, day of the week, date, month, and year. ALWAYS call this tool whenever DK asks 'abhi time kya hua', 'kya time ho raha hai', 'kya baj raha hai', 'aaj kaun sa din hai', 'date kya hai', 'time batao', or asks the current time in any city/timezone. NEVER refuse time questions.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "timezoneOrCity": {
          "type": "STRING",
          "description": "Optional city or timezone (default 'Asia/Kolkata' for Indian Standard Time)"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_weather",
    "description": "Get current weather and today's forecast for any place. Use for 'aaj mausam kaisa hai', 'weather batao', etc.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "place": {
          "type": "STRING",
          "description": "City or place name, e.g. 'Delhi', 'Mumbai'"
        }
      },
      "required": [
        "place"
      ]
    }
  },
  {
    "name": "get_air_quality",
    "description": "Get current air quality index (AQI) and pollution levels for any place. Use for 'AQI batao', 'pollution kitna hai', 'hawa saaf hai kya'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "place": {
          "type": "STRING",
          "description": "City or place name"
        }
      },
      "required": [
        "place"
      ]
    }
  },
  {
    "name": "get_sunrise_sunset",
    "description": "Get today's sunrise and sunset time for any place.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "place": {
          "type": "STRING",
          "description": "City or place name"
        }
      },
      "required": [
        "place"
      ]
    }
  },
  {
    "name": "get_recent_earthquakes",
    "description": "Get recent significant earthquakes (magnitude 4.5+) worldwide in the last 24 hours.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_exchange_rate",
    "description": "Get the currency exchange rate between two currencies. Use for 'dollar ka rate kya hai', 'USD to INR kitna hai'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "fromCurrency": {
          "type": "STRING",
          "description": "3-letter currency code to convert from, e.g. 'USD'"
        },
        "toCurrency": {
          "type": "STRING",
          "description": "3-letter currency code to convert to, e.g. 'INR'"
        }
      },
      "required": [
        "fromCurrency",
        "toCurrency"
      ]
    }
  },
  {
    "name": "get_crypto_price",
    "description": "Get the current price of a cryptocurrency. Use for 'bitcoin ka price kya hai', 'ethereum kitne ka hai'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "coinId": {
          "type": "STRING",
          "description": "CoinGecko coin id, e.g. 'bitcoin', 'ethereum', 'dogecoin'"
        },
        "vsCurrency": {
          "type": "STRING",
          "description": "Currency to price it in, e.g. 'usd', 'inr'. Default 'usd'."
        }
      },
      "required": [
        "coinId"
      ]
    }
  },
  {
    "name": "get_wikipedia_summary",
    "description": "Get a short summary about any topic, person, place, or thing from Wikipedia. Use for general knowledge questions like 'X kya hai', 'X ke bare me batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "topic": {
          "type": "STRING",
          "description": "The topic, person, or thing to look up"
        }
      },
      "required": [
        "topic"
      ]
    }
  },
  {
    "name": "get_wikiquote_summary",
    "description": "Get a short summary/overview about a person from Wikiquote, useful before sharing famous quotes context. Use for 'X ke quotes batao' style requests.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "person": {
          "type": "STRING",
          "description": "The person's name"
        }
      },
      "required": [
        "person"
      ]
    }
  },
  {
    "name": "search_book",
    "description": "Search for a book by title and get author, publish year, subjects. Use for 'X book ke bare me batao', 'is book ka author kaun hai'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "title": {
          "type": "STRING",
          "description": "Book title to search for"
        }
      },
      "required": [
        "title"
      ]
    }
  },
  {
    "name": "get_word_meaning",
    "description": "Get the dictionary meaning/definition of an English word. Use for 'X ka matlab kya hai', 'X word ka meaning batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "word": {
          "type": "STRING",
          "description": "The word to look up"
        }
      },
      "required": [
        "word"
      ]
    }
  },
  {
    "name": "get_country_info",
    "description": "Get basic info about a country — capital, population, region, currency, languages.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "country": {
          "type": "STRING",
          "description": "Country name"
        }
      },
      "required": [
        "country"
      ]
    }
  },
  {
    "name": "get_number_fact",
    "description": "Get an interesting fact about a number.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "number": {
          "type": "NUMBER",
          "description": "The number to get a fact about"
        }
      },
      "required": [
        "number"
      ]
    }
  },
  {
    "name": "get_trivia_question",
    "description": "Get a random trivia question with multiple choice options. Use when DK wants to play a quiz/trivia game.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_pincode_info",
    "description": "Look up post office details (district, state) for an Indian PIN code.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "pincode": {
          "type": "STRING",
          "description": "6-digit Indian PIN code"
        }
      },
      "required": [
        "pincode"
      ]
    }
  },
  {
    "name": "get_nearby_places",
    "description": "Find nearby places, shops, sweet shops (mithai), showrooms (car/bike/clothes/electronics), supermarkets, restaurants, hospitals, banks, etc. around a given city or location.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "place": {
          "type": "STRING",
          "description": "The reference location or city, e.g. 'Patna', 'Connaught Place Delhi'"
        },
        "amenity": {
          "type": "STRING",
          "description": "Type of place or search keyword, e.g. 'mithai', 'sweet shop', 'car showroom', 'restaurant', 'hospital', 'bank', 'supermarket'"
        }
      },
      "required": [
        "place",
        "amenity"
      ]
    }
  },
  {
    "name": "get_timezone_info",
    "description": "Get the current time and timezone for any place.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "place": {
          "type": "STRING",
          "description": "City or place name"
        }
      },
      "required": [
        "place"
      ]
    }
  },
  {
    "name": "get_covid_stats",
    "description": "Get COVID-19 case statistics for a country, or 'world' for global stats.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "country": {
          "type": "STRING",
          "description": "Country name, or 'world' for global. Default 'world'."
        }
      },
      "required": []
    }
  },
  {
    "name": "get_qr_code",
    "description": "Generate a QR code image URL for any text/link. Use for 'is link ka QR code banao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "text": {
          "type": "STRING",
          "description": "The text or URL to encode as a QR code"
        }
      },
      "required": [
        "text"
      ]
    }
  },
  {
    "name": "get_random_user",
    "description": "Generate a random fake user profile with name, avatar, email — useful for testing/demo purposes.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_github_user_info",
    "description": "Get public GitHub profile info for a username — name, bio, repo count, followers.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "username": {
          "type": "STRING",
          "description": "GitHub username"
        }
      },
      "required": [
        "username"
      ]
    }
  },
  {
    "name": "get_github_repo_info",
    "description": "Get public info about a GitHub repository — stars, forks, description, language.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "owner": {
          "type": "STRING",
          "description": "Repo owner/organization name"
        },
        "repo": {
          "type": "STRING",
          "description": "Repository name"
        }
      },
      "required": [
        "owner",
        "repo"
      ]
    }
  },
  {
    "name": "get_ip_lookup",
    "description": "Look up approximate location and ISP info for an IP address.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "ip": {
          "type": "STRING",
          "description": "The IP address to look up"
        }
      },
      "required": [
        "ip"
      ]
    }
  },
  {
    "name": "get_dad_joke",
    "description": "Get a random dad joke to lighten the mood.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_chuck_norris_joke",
    "description": "Get a random Chuck Norris joke.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_public_holidays",
    "description": "Get the list of public holidays for a country in a given year. Defaults to India if no country is specified.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "countryCode": {
          "type": "STRING",
          "description": "2-letter ISO country code, e.g. 'US', 'GB', 'IN'. Defaults to 'IN' if not given."
        },
        "year": {
          "type": "NUMBER",
          "description": "Year, defaults to current year if not given"
        }
      },
      "required": []
    }
  },
  {
    "name": "search_anime",
    "description": "Search for anime/manga info — episodes, score, synopsis, release year.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "title": {
          "type": "STRING",
          "description": "Anime/manga title"
        }
      },
      "required": [
        "title"
      ]
    }
  },
  {
    "name": "translate_text",
    "description": "Translate text into another language. Use for 'ise English me translate karo', 'is sentence ka Hindi translation batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "text": {
          "type": "STRING",
          "description": "The text to translate"
        },
        "targetLang": {
          "type": "STRING",
          "description": "Target language code, e.g. 'en', 'hi', 'fr', 'es'"
        }
      },
      "required": [
        "text",
        "targetLang"
      ]
    }
  },
  {
    "name": "get_news",
    "description": "Get latest live news headlines, top 10 news, politics, local city news, international/world news, or viral/trending news. Filter with topic like 'top 10', 'politics', 'local', 'world', 'viral', 'sports', or a city name (e.g. 'Patna local', 'Delhi').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "topic": {
          "type": "STRING",
          "description": "Filter topic or category: 'top 10', 'politics', 'local', 'world', 'viral', 'business', 'tech', or specific city/topic"
        },
        "country": {
          "type": "STRING",
          "description": "2-letter country code, default 'in' for India"
        },
        "count": {
          "type": "INTEGER",
          "description": "Number of news headlines to fetch (default 10)"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_cricket_scores",
    "description": "Get real-time live cricket match scores, ongoing matches, current wickets/runs/overs, and match status. Surfaces India matches first.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "team": {
          "type": "STRING",
          "description": "Optional specific team name or match filter (e.g. 'India', 'Sri Lanka', 'Australia')"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_upcoming_cricket_matches",
    "description": "Get upcoming cricket fixtures, future series schedule, tournament dates, and upcoming match details (e.g. India tour, IPL, World Cup).",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "filter": {
          "type": "STRING",
          "description": "Optional filter for team or tournament (e.g. 'India', 'IPL', 'all')"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_cricket_player_profile",
    "description": "Get complete bio-data, role, age, birthplace, teams, career stats (runs, wickets, centuries in ODI, Test, T20I, IPL), and major achievements/records for any Indian or International cricketer (e.g. 'Virat Kohli', 'Rohit Sharma', 'MS Dhoni', 'Jasprit Bumrah', 'Shubman Gill', 'Hardik Pandya', 'Sachin Tendulkar').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "playerName": {
          "type": "STRING",
          "description": "Name of the cricketer (e.g. 'Virat Kohli', 'Rohit Sharma', 'MS Dhoni', 'Jasprit Bumrah', 'Pat Cummins')"
        }
      },
      "required": [
        "playerName"
      ]
    }
  },
  {
    "name": "get_sports_events",
    "description": "Search for sports events/matches (non-cricket, e.g. football, NBA, tennis) by team or league name.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "league": {
          "type": "STRING",
          "description": "Team, league, or event name to search for"
        }
      },
      "required": [
        "league"
      ]
    }
  },
  {
    "name": "get_stock_price",
    "description": "Get the current stock price for a stock symbol. For Indian stocks use '.BSE' suffix, e.g. 'RELIANCE.BSE'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "symbol": {
          "type": "STRING",
          "description": "Stock ticker symbol"
        }
      },
      "required": [
        "symbol"
      ]
    }
  },
  {
    "name": "get_movie_info",
    "description": "Get info about a movie — overview, release date, rating, poster.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "title": {
          "type": "STRING",
          "description": "Movie title"
        }
      },
      "required": [
        "title"
      ]
    }
  },
  {
    "name": "search_pexels_image",
    "description": "Search for free stock photos matching a query.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "What to search images for"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "search_unsplash_image",
    "description": "Search for high-quality stock photos matching a query.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "What to search images for"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_directions",
    "description": "Get driving distance (km), estimated travel time (hours/mins), and route details between two places/cities (e.g. 'Delhi to Patna').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "fromPlace": {
          "type": "STRING",
          "description": "Starting city or location"
        },
        "toPlace": {
          "type": "STRING",
          "description": "Destination city or location"
        }
      },
      "required": [
        "fromPlace",
        "toPlace"
      ]
    }
  },
  {
    "name": "get_nutrition_info",
    "description": "Get nutrition/calorie breakdown for a food item or meal description. Use for 'X me kitni calorie hai', 'ye khane me kitna protein hai'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "foodQuery": {
          "type": "STRING",
          "description": "Food item or quantity description, e.g. '2 rotis and a bowl of dal'"
        }
      },
      "required": [
        "foodQuery"
      ]
    }
  },
  {
    "name": "search_recipe",
    "description": "Search for cooking recipes by dish name, cuisine, diet, or nutrition goals using Spoonacular API. Use for 'Butter Chicken ki recipe batao', 'Italian pasta kaise banate hain', 'high protein vegetarian dinner'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Dish name or food query (e.g. 'Biryani', 'Pasta', 'Paneer Tikka')"
        },
        "cuisine": {
          "type": "STRING",
          "description": "Optional cuisine (e.g. 'Indian', 'Italian', 'Mexican', 'Chinese')"
        },
        "diet": {
          "type": "STRING",
          "description": "Optional diet restriction (e.g. 'vegetarian', 'vegan', 'gluten free', 'ketogenic')"
        },
        "type": {
          "type": "STRING",
          "description": "Optional meal type (e.g. 'main course', 'dessert', 'breakfast', 'snack', 'soup')"
        },
        "maxCalories": {
          "type": "NUMBER",
          "description": "Optional maximum calories per serving"
        },
        "minProtein": {
          "type": "NUMBER",
          "description": "Optional minimum protein in grams"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "search_recipes_by_ingredients",
    "description": "Find delicious recipes based on available ingredients at home / fridge using Spoonacular API. Use for 'Ghar pe paneer, tamatar aur shimla mirch hai, kya banau?', 'fridge me chicken aur pyaaz hai'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "ingredients": {
          "type": "STRING",
          "description": "Comma-separated list of ingredients available (e.g. 'paneer, tomato, onion, capsicum')"
        },
        "count": {
          "type": "NUMBER",
          "description": "Number of recipes to find (default 5)"
        }
      },
      "required": [
        "ingredients"
      ]
    }
  },
  {
    "name": "get_recipe_details",
    "description": "Get full detailed recipe, exact ingredient measurements, and step-by-step cooking instructions using Spoonacular API. Use for 'Shahi Paneer banane ka poora step by step tarika batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "recipeIdOrTitle": {
          "type": "STRING",
          "description": "Recipe ID (number) or dish title name"
        }
      },
      "required": [
        "recipeIdOrTitle"
      ]
    }
  },
  {
    "name": "get_random_recipes",
    "description": "Get random recipe recommendations and dish inspiration (e.g. 'aaj dinner me kya banau?', 'kuch tasty vegetarian suggest karo').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "tags": {
          "type": "STRING",
          "description": "Optional tags (e.g. 'vegetarian', 'indian', 'dessert', 'breakfast')"
        },
        "count": {
          "type": "NUMBER",
          "description": "Number of recipes (default 3)"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_ingredient_substitutes",
    "description": "Find culinary ingredient replacements and substitutes using Spoonacular API. Use for 'Butter ki jagah kya daalu?', 'dahi nahi hai to kya use karein?', 'egg substitute batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "ingredientName": {
          "type": "STRING",
          "description": "Ingredient name to substitute (e.g. 'butter', 'egg', 'buttermilk', 'paneer')"
        }
      },
      "required": [
        "ingredientName"
      ]
    }
  },
  {
    "name": "generate_meal_plan",
    "description": "Generate structured daily or weekly meal plan with calorie targets and dietary preferences using Spoonacular API. Use for '2000 calorie ka vegetarian daily meal plan banao', 'weekly healthy diet plan'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "targetCalories": {
          "type": "NUMBER",
          "description": "Target daily calories (e.g. 1800, 2000, 2500)"
        },
        "timeFrame": {
          "type": "STRING",
          "description": "'day' or 'week' (default 'day')"
        },
        "diet": {
          "type": "STRING",
          "description": "Diet preference (e.g. 'vegetarian', 'vegan', 'ketogenic', 'pescetarian')"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_flight_status",
    "description": "Get the current status of a flight by flight number.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "flightNumber": {
          "type": "STRING",
          "description": "IATA flight number, e.g. 'AI101'"
        }
      },
      "required": [
        "flightNumber"
      ]
    }
  },
  {
    "name": "search_govt_data",
    "description": "Search India government open data catalog (data.gov.in) for schemes, datasets, or public info by keyword.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "keyword": {
          "type": "STRING",
          "description": "Keyword to search government datasets/schemes for"
        }
      },
      "required": [
        "keyword"
      ]
    }
  },
  {
    "name": "get_product_by_barcode",
    "description": "Look up product info (title, brand, price range) by scanning/entering a barcode/UPC number.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "upc": {
          "type": "STRING",
          "description": "The barcode/UPC number"
        }
      },
      "required": [
        "upc"
      ]
    }
  },
  {
    "name": "get_trains_between_stations",
    "description": "Find trains running between two cities/stations. Use for 'Delhi se Mumbai konsi trains hain', 'X se Y ke beech train batao'. Free quota is very limited, so only call this when DK explicitly asks about trains.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "fromPlace": {
          "type": "STRING",
          "description": "Origin city/station name"
        },
        "toPlace": {
          "type": "STRING",
          "description": "Destination city/station name"
        }
      },
      "required": [
        "fromPlace",
        "toPlace"
      ]
    }
  },
  {
    "name": "get_train_schedule",
    "description": "Get the full stop-by-stop schedule/route with station codes and platform numbers for a specific train number or train name (e.g. '12951' or 'Shiv Ganga Express').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "trainNumberOrName": {
          "type": "STRING",
          "description": "The train number (e.g. '12951') or train name (e.g. 'Shiv Ganga Express', 'Mumbai Rajdhani')"
        }
      },
      "required": [
        "trainNumberOrName"
      ]
    }
  },
  {
    "name": "get_live_train_status",
    "description": "Get real-time live running status, current location, delay, next station, and expected platform number for a running train by train number OR train name. Use when DK asks live status, kahan tak pahunchi, late hai ya nahi, ya platform number kya hai.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "trainNumberOrName": {
          "type": "STRING",
          "description": "The train number (e.g. '12559') or train name (e.g. 'Shiv Ganga Express', 'Vande Bharat Delhi to Varanasi')"
        },
        "startDay": {
          "type": "INTEGER",
          "description": "Journey start day: 0 for today (default), 1 for yesterday, 2 for 2 days ago"
        }
      },
      "required": [
        "trainNumberOrName"
      ]
    }
  },
  {
    "name": "search_train",
    "description": "Find the official train number and route for any train name (e.g. 'Shiv Ganga', 'Poorva Express', 'Vande Bharat', 'Lucknow Mail').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Train name or keyword to search"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_pnr_status",
    "description": "Check the booking/PNR status of a train ticket. Free quota is very limited, so only call this when DK explicitly gives a PNR number to check.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "pnrNumber": {
          "type": "STRING",
          "description": "The 10-digit PNR number"
        }
      },
      "required": [
        "pnrNumber"
      ]
    }
  },
  {
    "name": "search_product_deals",
    "description": "Search top products, real-time prices, and direct buy links across Amazon India, Flipkart, and Meesho. Supports high-to-low price sorting, pagination (next 5 products), and single-store filtering (e.g. 'sirf meesho par search karo').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "productName": {
          "type": "STRING",
          "description": "Name of the product or item to search (e.g. 'football', 'running shoes', 'wireless earbuds')"
        },
        "platform": {
          "type": "STRING",
          "description": "Optional store filter: 'all' (default), 'amazon', 'flipkart', or 'meesho'"
        },
        "sortBy": {
          "type": "STRING",
          "description": "Sort order: 'high_to_low' (default, most expensive first), 'low_to_high' (cheapest first), or 'relevance'"
        },
        "page": {
          "type": "INTEGER",
          "description": "Page number: 1 for top 5, 2 for next 5 results (items 6-10), 3 for items 11-15"
        }
      },
      "required": [
        "productName"
      ]
    }
  },
  {
    "name": "get_daily_life_suggestion",
    "description": "Get structured daily life suggestions for Morning Routine, Health/Diet tips, Productivity/Focus methods, or Stress Relief/Peace.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "category": {
          "type": "STRING",
          "description": "Category: 'routine', 'diet', 'focus', 'stress', or 'motivation'"
        },
        "context": {
          "type": "STRING",
          "description": "Optional specific context or situation"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_website_or_helpline_info",
    "description": "Get verified information about what happens on a website/portal (e.g. IRCTC, UIDAI, EPFO, SBI, Amazon, Cybercrime), its official URL, and verified customer care helpline numbers.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Name of the website, company, bank, or government portal (e.g. 'IRCTC', 'UIDAI Aadhaar', 'EPFO', 'SBI', 'Amazon', 'Cybercrime')"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_instagram_user_info",
    "description": "Get public profile details of any Instagram handle or user: Realtime Followers count, Following count, Total Posts count, Bio, Verified status, and Latest Reels/Posts with Likes, Views, and Comments.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "username": {
          "type": "STRING",
          "description": "The Instagram username or handle (e.g. 'virat.kohli', 'cristiano', 'narendramodi')"
        }
      },
      "required": [
        "username"
      ]
    }
  },
  {
    "name": "search_instagram_user",
    "description": "Search for Instagram IDs, user handles, and profiles by person name, celebrity name, brand, or query (e.g. 'Salman Khan', 'Virat Kohli', 'CarryMinati').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Person name, creator, brand or handle to search on Instagram"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_x_twitter_info",
    "description": "Get X (Twitter) profile details, follower counts, verified blue tick, bio, and latest live tweets with likes and retweets for any username or search topic.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "usernameOrTopic": {
          "type": "STRING",
          "description": "The X (Twitter) username (e.g. 'elonmusk', 'narendramodi', 'imVkohli') or topic"
        }
      },
      "required": [
        "usernameOrTopic"
      ]
    }
  },
  {
    "name": "search_x_twitter",
    "description": "Search for X (Twitter) accounts, user handles, or trending topics by person name or keywords (e.g. 'Elon Musk', 'Virat Kohli', 'AI').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Person name, handle, or topic to search on X (Twitter)"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_location_overview",
    "description": "Get a comprehensive map-like location briefing for DK's current or requested place: exact address, coordinates, current weather, temperature, Air Quality Index (AQI), and direct Google Maps link. Use whenever DK mentions his location or asks about a place.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "place": {
          "type": "STRING",
          "description": "City, area, colony, or landmark (e.g. 'Connaught Place Delhi', 'Lucknow', 'Patna', 'Bandra Mumbai')"
        }
      },
      "required": [
        "place"
      ]
    }
  },
  {
    "name": "search_youtube",
    "description": "Search YouTube videos, channels (@channel), or trending topics with direct YouTube links.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "YouTube search query or channel name (e.g. 'CarryMinati', 'Python tutorial')"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "search_reddit",
    "description": "Search Reddit community threads, discussions, and honest public opinions on any topic or subreddit (e.g. 'r/india', 'best phone under 20k').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "topicOrSubreddit": {
          "type": "STRING",
          "description": "Topic to search or subreddit name (e.g. 'india', 'tech', 'smartphones')"
        }
      },
      "required": [
        "topicOrSubreddit"
      ]
    }
  },
  {
    "name": "search_music",
    "description": "Search songs, artists, albums, release year, and get direct Spotify play links.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "songOrArtist": {
          "type": "STRING",
          "description": "Song name, singer, or artist (e.g. 'Kesariya Arijit Singh', 'Shape of You')"
        }
      },
      "required": [
        "songOrArtist"
      ]
    }
  },
  {
    "name": "search_song_by_lyrics",
    "description": "Identify and search a song using its lyrics, memorable lines, or hummed words (e.g. 'tu hai to mujhe phir aur kya chahiye', 'tere vaaste falak se main chaand', 'shape of you lyrics'). Uses exact and fuzzy partial matching to identify the song title, artist/singer, album, matching lyrics snippet, and links.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "lyrics": {
          "type": "STRING",
          "description": "The lyrics phrase, line, or words to search for (e.g. 'tu hai to mujhe phir aur kya chahiye', 'tere vaaste falak se main chaand')"
        },
        "artistHint": {
          "type": "STRING",
          "description": "Optional singer or artist name if known or hinted by DK (e.g. 'Arijit Singh', 'Ed Sheeran')"
        }
      },
      "required": [
        "lyrics"
      ]
    }
  },
  {
    "name": "identify_playing_song",
    "description": "Identify any music/song playing live in the background, room, car, or TV (Shazam-style acoustic recognition). Use when DK says 'ye kaun sa gana baj raha hai', 'ye music pehchano', 'identify playing song'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "songClue": {
          "type": "STRING",
          "description": "Optional title clue, language, or singer hint if DK mentioned any"
        }
      },
      "required": []
    }
  },
  {
    "name": "identify_song_by_humming_or_tune",
    "description": "Identify a song from DK's humming, whistling, tune description, or beat rhythm (Google Hum-to-Search style). Use when DK hums ('ta na na...', 'hmm hmm...'), whistles, or describes a tune/rhythm.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "hummingOrTuneClue": {
          "type": "STRING",
          "description": "The hummed words, rhythm description, tune, or partial lyrics (e.g. 'ta na na na... tere vaaste falak se', 'hmm hmm romantic slow flute song')"
        },
        "artistHint": {
          "type": "STRING",
          "description": "Optional singer or artist hint"
        }
      },
      "required": [
        "hummingOrTuneClue"
      ]
    }
  },
  {
    "name": "get_morning_briefing",
    "description": "Deliver Iron Man VIP Morning Briefing Protocol (live weather, top headlines, pending reminders, and stock market status). Use when DK says 'good morning', 'aaj ka briefing do', 'morning update'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "city": {
          "type": "STRING",
          "description": "Optional city name for weather (default 'Patna, India')"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_system_health",
    "description": "Get real-time JARVIS PC and hardware diagnostics (CPU cores & load, RAM total/used/free, uptime, platform health). Use when DK asks 'system status check karo', 'laptop health check', 'CPU RAM usage batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "deep_autonomous_research",
    "description": "Execute deep multi-stage autonomous research on any topic, technology, company, or concept (Perplexity style). Generates comprehensive report with executive summary, key findings, and takeaways.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "topic": {
          "type": "STRING",
          "description": "The topic, research question, or subject to investigate"
        }
      },
      "required": [
        "topic"
      ]
    }
  },
  {
    "name": "analyze_screen_context",
    "description": "Analyze live screen frame or active window context (code errors, terminal output, diagrams, UI design). Use when DK says 'meri screen dekho', 'ye error check karo', 'is image/diagram ko explain karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "userQuery": {
          "type": "STRING",
          "description": "What DK wants explained or diagnosed about the screen"
        },
        "imageBase64": {
          "type": "STRING",
          "description": "Optional base64 image frame if captured directly"
        }
      },
      "required": [
        "userQuery"
      ]
    }
  },
  {
    "name": "switch_voice_persona",
    "description": "Switch Friday's persona, accent, or attitude (e.g. 'friday_classic', 'jarvis_british', 'cyberpunk_ai', 'professor_mentor', 'motivational_coach'). Use when DK asks to change persona, switch to JARVIS, or act like a coach/professor.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "personaName": {
          "type": "STRING",
          "description": "Name or style of persona (e.g. 'jarvis', 'cyberpunk', 'professor', 'coach', 'friday')"
        }
      },
      "required": [
        "personaName"
      ]
    }
  },
  {
    "name": "organize_directory",
    "description": "Sort and organize all cluttered files in a folder (Downloads / Desktop) into clean subfolders (Images, Documents, Videos, Code, Archives, Installers). Use when DK says 'Downloads organize karo', 'Desktop files arrange karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "directoryPath": {
          "type": "STRING",
          "description": "Optional folder path to organize (default: Downloads folder)"
        }
      },
      "required": []
    }
  },
  {
    "name": "clean_temp_files",
    "description": "Scan and clean temporary Windows cache and junk files to free up disk space. Use when DK says 'temp files delete karo', 'PC junk clean karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "add_expense",
    "description": "Log an expense with amount, description, and auto-categorization into the personal budget ledger. Use when DK says '500 rupay petrol me kharch hue', 'Khane pe 300 lag gaye'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "amount": {
          "type": "NUMBER",
          "description": "Expense amount in Rupees (e.g. 500, 1200)"
        },
        "description": {
          "type": "STRING",
          "description": "What the expense was for (e.g. 'petrol', 'dinner with friends', 'wifi recharge')"
        },
        "categoryHint": {
          "type": "STRING",
          "description": "Optional category if explicitly specified"
        }
      },
      "required": [
        "amount",
        "description"
      ]
    }
  },
  {
    "name": "get_expense_summary",
    "description": "Get monthly personal expense breakdown, total spent, and top spending category. Use when DK asks 'Is mahine kitna kharcha hua', 'Expense summary batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "filterMonth": {
          "type": "STRING",
          "description": "Optional month filter in YYYY-MM format (e.g. '2026-08')"
        }
      },
      "required": []
    }
  },
  {
    "name": "schedule_meeting",
    "description": "Schedule a meeting, appointment, or calendar event with automatic 15-minute proactive audio reminder. Use when DK says 'Kal subah 11 baje meeting schedule karo', 'Doctor appointment add karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "title": {
          "type": "STRING",
          "description": "Meeting title or purpose (e.g. 'Project Review with Team', 'Client Call')"
        },
        "timeString": {
          "type": "STRING",
          "description": "Date and time of meeting (e.g. 'Tomorrow 11 AM', 'Friday 4 PM')"
        },
        "durationMinutes": {
          "type": "NUMBER",
          "description": "Duration of meeting in minutes (default 30)"
        },
        "locationOrLink": {
          "type": "STRING",
          "description": "Optional Google Meet / Zoom link or venue"
        }
      },
      "required": [
        "title",
        "timeString"
      ]
    }
  },
  {
    "name": "get_upcoming_meetings",
    "description": "Get a list of upcoming scheduled meetings and calendar events. Use when DK asks 'Meri upcoming meetings kaun si hain', 'Calendar check karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "summarize_inbox",
    "description": "Summarize unread emails and priority inbox messages. Use when DK asks 'unread emails check karo', 'inbox status batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "send_quick_email",
    "description": "Draft and send an email to a recipient with subject and body text. Use when DK says 'Email bhejo', 'Email draft karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "toEmail": {
          "type": "STRING",
          "description": "Recipient email address (e.g. 'friend@example.com')"
        },
        "subject": {
          "type": "STRING",
          "description": "Subject of the email"
        },
        "bodyText": {
          "type": "STRING",
          "description": "Body contents of the email"
        }
      },
      "required": [
        "toEmail",
        "subject",
        "bodyText"
      ]
    }
  },
  {
    "name": "log_water_intake",
    "description": "Log water intake and track progress toward the daily 8-glass hydration goal. Use when DK says '1 glass paani piya', 'water log karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "glasses": {
          "type": "NUMBER",
          "description": "Number of glasses of water (default 1)"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_health_status",
    "description": "Check daily hydration percentage, posture ergonomics, and eye-rest tips. Use when DK asks 'Health status batao', 'Aaj kitna paani piya'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "add_to_shopping_list",
    "description": "Add items to the voice grocery and shopping checklist. Use when DK says 'Doodh, bread aur ande shopping list me daal do'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "itemsQuery": {
          "type": "STRING",
          "description": "Comma or 'and' separated list of items to buy"
        }
      },
      "required": [
        "itemsQuery"
      ]
    }
  },
  {
    "name": "get_shopping_list",
    "description": "View the active shopping and grocery checklist. Use when DK asks 'Shopping list me kya kya hai', 'Checklist dikhao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "send_shopping_list_on_whatsapp",
    "description": "Send the formatted shopping checklist directly to DK's WhatsApp. Use when DK says 'Shopping list WhatsApp par bhej do'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "targetPhone": {
          "type": "STRING",
          "description": "Optional phone number (defaults to DK's WhatsApp)"
        }
      },
      "required": []
    }
  },
  {
    "name": "clear_shopping_list",
    "description": "Clear all items from the shopping list after shopping is complete. Use when DK says 'Shopping list clear kar do'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "trigger_emergency_sos",
    "description": "Trigger an urgent high-priority Emergency SOS alert to trusted contacts via WhatsApp. Use when DK says 'Emergency SOS alert', 'Help emergency'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "customMessage": {
          "type": "STRING",
          "description": "Optional custom emergency message or situation description"
        },
        "targetPhone": {
          "type": "STRING",
          "description": "Optional specific contact phone number to alert"
        }
      },
      "required": []
    }
  },
  {
    "name": "generate_daily_podcast",
    "description": "Generate and deliver a custom 2-minute energetic tech and breaking news audio podcast. Use when DK says 'Daily tech podcast sunao', 'Aaj ka audio summary do'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "send_fast2sms_message",
    "description": "Send a real cellular mobile SMS to any Indian phone number or saved contact by name (e.g. 'Papa', 'Rohit', '9876543210') using Fast2SMS Gateway. Use when DK says 'SMS bhejo', 'Papa ko SMS karo', 'message send karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "phoneNumberOrContactName": {
          "type": "STRING",
          "description": "10-digit Indian mobile number OR saved contact name (e.g. 'Papa', 'Rohit', 'Aman', '9876543210')"
        },
        "messageText": {
          "type": "STRING",
          "description": "Body text of the SMS"
        }
      },
      "required": [
        "phoneNumberOrContactName",
        "messageText"
      ]
    }
  },
  {
    "name": "summarize_voice_note",
    "description": "Summarize a WhatsApp audio voice note into a 2-line executive digest and action items. Use when DK asks to summarize an incoming audio message.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "transcript": {
          "type": "STRING",
          "description": "The audio note speech transcript or text"
        },
        "senderName": {
          "type": "STRING",
          "description": "Name of the person who sent the voice note"
        }
      },
      "required": [
        "transcript"
      ]
    }
  },
  {
    "name": "store_vault_secret",
    "description": "Store a password, API key, or confidential note in the AES-256 Encrypted AI Vault. Use when DK says 'Vault me save karo', 'Password yaad rakh lo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "keyName": {
          "type": "STRING",
          "description": "Identifier / name of the secret (e.g. 'wifi_password', 'github_token')"
        },
        "secretValue": {
          "type": "STRING",
          "description": "The confidential password, key, or secret value"
        },
        "category": {
          "type": "STRING",
          "description": "Optional category (e.g. 'Passwords', 'API Keys', 'Personal')"
        }
      },
      "required": [
        "keyName",
        "secretValue"
      ]
    }
  },
  {
    "name": "retrieve_vault_secret",
    "description": "Retrieve and decrypt a stored secret or password from the encrypted vault. Use when DK asks 'Vault se password batao', 'Mera wifi password kya hai'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "keyName": {
          "type": "STRING",
          "description": "Identifier / name of the secret to retrieve"
        }
      },
      "required": [
        "keyName"
      ]
    }
  },
  {
    "name": "list_vault_secrets",
    "description": "List all secret keys stored in the encrypted AI vault. Use when DK asks 'Vault me kya kya save hai'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_train_live_status",
    "description": "Get real-time live Indian Railways train running status, exact current GPS location, delay minutes, and platform number via RailRadar. Use when DK asks '12309 train kahan hai', 'Train ka live running status batao', 'Train kitni late hai'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "trainNumberOrName": {
          "type": "STRING",
          "description": "Train number or name (e.g. '12309', '12952', 'Rajdhani Express')"
        }
      },
      "required": [
        "trainNumberOrName"
      ]
    }
  },
  {
    "name": "check_pnr_status",
    "description": "Check real-time Indian Railways 10-digit PNR status, coach, and berth confirmation via RailRadar. Use when DK asks to check a 10-digit PNR number.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "pnrNumber": {
          "type": "STRING",
          "description": "10-digit Indian Railways PNR number (e.g. '2847291048')"
        }
      },
      "required": [
        "pnrNumber"
      ]
    }
  },
  {
    "name": "control_smart_device",
    "description": "Control smart home lights, smart plugs, AC temperature, and fan speeds. Use when DK says 'Light band karo', 'AC 24 degree karo', 'Fan speed badhao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "deviceNameOrRoom": {
          "type": "STRING",
          "description": "Device name or room (e.g. 'Desk Light', 'AC', 'Bedroom lights')"
        },
        "action": {
          "type": "STRING",
          "description": "Action: 'turn_on', 'turn_off', 'toggle', 'set_temp', 'set_brightness'"
        },
        "value": {
          "type": "NUMBER",
          "description": "Optional numeric value for temperature or brightness (e.g. 24 for AC, 80 for brightness)"
        }
      },
      "required": [
        "deviceNameOrRoom",
        "action"
      ]
    }
  },
  {
    "name": "get_smart_home_status",
    "description": "View all connected IoT smart home devices and their current ON/OFF status. Use when DK asks 'Smart home status batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "start_focus_mode",
    "description": "Activate Pomodoro Focus Mode with relaxing background Lo-Fi audio stream and silenced notifications. Use when DK says 'Focus mode on karo', '25 minute ka study timer chalao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "durationMinutes": {
          "type": "NUMBER",
          "description": "Duration of focus session in minutes (default 25)"
        },
        "goalTitle": {
          "type": "STRING",
          "description": "Focus goal or work title (e.g. 'Deep Coding', 'Exam Prep')"
        }
      },
      "required": []
    }
  },
  {
    "name": "stop_focus_mode",
    "description": "Deactivate Pomodoro Focus Mode and return to normal mode. Use when DK says 'Focus mode band karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "track_product_price",
    "description": "Track an e-commerce product price on Amazon/Flipkart and set target drop alert. Use when DK says 'Price monitor karo', 'Is product ka price track karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "productName": {
          "type": "STRING",
          "description": "Name of the product (e.g. 'iPhone 16 Pro', 'MacBook Air M3')"
        },
        "currentPrice": {
          "type": "NUMBER",
          "description": "Current product price in Rupees"
        },
        "targetPrice": {
          "type": "NUMBER",
          "description": "Target alert threshold price in Rupees"
        },
        "productUrl": {
          "type": "STRING",
          "description": "Optional product URL"
        }
      },
      "required": [
        "productName",
        "currentPrice"
      ]
    }
  },
  {
    "name": "get_tracked_prices",
    "description": "List all active tracked e-commerce products and target price drop alerts. Use when DK asks 'Kaun se products track ho rahe hain'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "compare_product_prices",
    "description": "Compare live prices of any product across Flipkart, Amazon India, and Meesho. Generates interactive horizontal cards deck on the dashboard. Use when DK/user asks 'football ka price kya hai', 'laptop price batao', 'compare prices', etc.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "The product name to search and compare (e.g. 'football', 'iPhone 15', 'gaming laptop')"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "highlight_ecommerce_product",
    "description": "Advance or highlight a specific product in the horizontal product deck on the dashboard. Use when DK/user says 'ye pasand nahi aaya, dusra dikhao', 'next product', 'agla dikhao', '2nd product ka batao', or asks about product 2, 3, etc. You must then speak about that highlighted product's price, discount, and store details.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "index": {
          "type": "NUMBER",
          "description": "0-based index of the product to highlight in the deck (e.g., 1 for 2nd product, 2 for 3rd product)"
        }
      },
      "required": [
        "index"
      ]
    }
  },
  {
    "name": "place_ecommerce_order",
    "description": "Place an e-commerce order for any product. If user chooses Cash on Delivery ('COD'), the order is immediately confirmed and placed autonomously. If user chooses Online Payment ('ONLINE_UPI'), dynamic PhonePe, Google Pay (GPay), and Paytm UPI payment links and QR code are instantly generated and sent to Boss's WhatsApp and Telegram. Use when user says 'order kar do', 'ye buy kar do', 'COD se order karo', 'online payment se order karo', etc.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "productName": {
          "type": "STRING",
          "description": "The title of the product to order"
        },
        "price": {
          "type": "NUMBER",
          "description": "The price in INR"
        },
        "paymentMethod": {
          "type": "STRING",
          "description": "Payment method chosen: 'COD' (Cash on Delivery) or 'ONLINE_UPI' (PhonePe / GPay / Paytm)"
        },
        "store": {
          "type": "STRING",
          "description": "The store name ('Amazon', 'Flipkart', 'Meesho')"
        },
        "productUrl": {
          "type": "STRING",
          "description": "Optional direct product URL"
        },
        "deliveryAddress": {
          "type": "STRING",
          "description": "Optional custom delivery address"
        }
      },
      "required": [
        "productName",
        "price",
        "paymentMethod"
      ]
    }
  },
  {
    "name": "open_store_login_helper",
    "description": "Opens an interactive visible browser window for Flipkart or Amazon so Boss can log in once with mobile number/OTP. Once logged in, session cookies are saved permanently in local storage for 100% autonomous 1-click ordering. Use when user says 'Flipkart me login karwa do', 'Amazon login helper kholo', 'account connect karo', etc.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "store": {
          "type": "STRING",
          "description": "The store to log into: 'flipkart' or 'amazon'"
        }
      },
      "required": [
        "store"
      ]
    }
  },
  {
    "name": "send_product_buy_link",
    "description": "Send direct 1-click single product purchase/buy link directly to Boss's WhatsApp and Telegram with an inline buy button. Use when DK says 'is product ka buy link bhejo', 'link WhatsApp par send karo', 'direct link bhej do', etc.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "productName": {
          "type": "STRING",
          "description": "The product title"
        },
        "price": {
          "type": "NUMBER",
          "description": "The product price in INR"
        },
        "store": {
          "type": "STRING",
          "description": "The store name ('Amazon', 'Flipkart', 'Meesho')"
        },
        "productUrl": {
          "type": "STRING",
          "description": "The direct individual product page URL"
        }
      },
      "required": [
        "productName",
        "price",
        "store",
        "productUrl"
      ]
    }
  },
  {
    "name": "analyze_document",
    "description": "Analyze a PDF, resume, contract, research paper, or technical specification. Use when DK asks to analyze, review, or summarize a document.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "documentTextOrSnippet": {
          "type": "STRING",
          "description": "The document text or extracted content"
        },
        "docTitle": {
          "type": "STRING",
          "description": "Title or filename of the document"
        }
      },
      "required": [
        "documentTextOrSnippet"
      ]
    }
  },
  {
    "name": "query_document",
    "description": "Ask specific questions or query clauses from a document. Use when DK asks questions about a document.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "documentText": {
          "type": "STRING",
          "description": "The document text content"
        },
        "question": {
          "type": "STRING",
          "description": "The specific question to answer"
        }
      },
      "required": [
        "documentText",
        "question"
      ]
    }
  },
  {
    "name": "get_daily_work_digest",
    "description": "Generate end-of-day daily work, coding, and productivity activity digest with overall grade. Use when DK says 'Aaj ka work report do', 'Daily productivity digest batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "send_messenger_chat",
    "description": "Send text messages, photos, videos, PDF documents, or web links to any contact in Friday Messenger. Use when DK says 'Friday Messenger me message bhejo', 'GF/friend ko Messenger par photo/PDF bhejo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "chatId": {
          "type": "STRING",
          "description": "Contact ID in Friday Messenger (e.g. 'boss_dk', 'special_gf', 'best_friend_aman', 'unknown_client')"
        },
        "text": {
          "type": "STRING",
          "description": "Message text or caption"
        },
        "mediaType": {
          "type": "STRING",
          "description": "Type of media: 'text', 'image', 'video', 'pdf', 'link', 'audio'"
        },
        "mediaUrl": {
          "type": "STRING",
          "description": "Optional URL for image, video, or link"
        },
        "mediaTitle": {
          "type": "STRING",
          "description": "Optional title for document/PDF"
        }
      },
      "required": [
        "chatId",
        "text"
      ]
    }
  },
  {
    "name": "get_messenger_inbox",
    "description": "Get all Friday Messenger chats, contacts, unread counts, and assigned roles. Use when DK asks 'Friday Messenger inbox check karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "set_messenger_contact_role",
    "description": "Set or change a contact's role in Friday Messenger ('boss' | 'girlfriend' | 'friend' | 'unknown').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "contactId": {
          "type": "STRING",
          "description": "Contact ID or name"
        },
        "role": {
          "type": "STRING",
          "description": "New role: 'boss', 'girlfriend', 'friend', 'unknown'"
        }
      },
      "required": [
        "contactId",
        "role"
      ]
    }
  },
  {
    "name": "scan_connected_wifi_devices",
    "description": "Scan and list all devices currently connected to the same Wi-Fi / Local Network (e.g., Mobile phones like Apple iPhone, Samsung, Xiaomi, OnePlus, Laptops, PCs, Smart TVs, IoT devices, Routers/Gateways). Returns the total count, device types, brands, IP addresses, and hostnames. Use when DK asks 'WiFi se kaun kaun connected hai?', 'Mere WiFi par kitne phone chal rahe hain?', 'Network scan karo', 'Connected devices dikhao', or 'WiFi devices check karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "forceRefresh": {
          "type": "BOOLEAN",
          "description": "Set to true to force a fresh ARP ping sweep of the network instead of using cached results."
        }
      },
      "required": []
    }
  },
  {
    "name": "scan_nearby_wifi_recon",
    "description": "Level 4 Cyber Airspace Recon: Scan all surrounding Wi-Fi networks over-the-air, analyze security encryption (Open / WPA2 / WPA3), detect rogue AP / evil twin anomalies, find hidden SSIDs, and recommend cleanest zero-ping channels. Use when DK asks 'Aas paas kaun se Wi-Fi hain?', 'Wi-Fi security recon karo', 'Hawa me kitne Wi-Fi chal rahe hain?', 'Open Wi-Fi hai kya koi?', or 'Best channel kaun sa hai?'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "forceRefresh": {
          "type": "BOOLEAN",
          "description": "Set to true to force fresh over-the-air BSSID radio scan."
        }
      },
      "required": []
    }
  },
  {
    "name": "start_voice_enrollment",
    "description": "Start guided multi-step voice biometric enrollment for a new speaker (Boss, Friend, Family, or Guest). Requires Boss's Voice PIN for authorization.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "pin": {
          "type": "STRING",
          "description": "Boss's secret Voice PIN (e.g. '1234')"
        },
        "name": {
          "type": "STRING",
          "description": "Name of the person being enrolled (e.g. 'Aman', 'Priya', 'Boss DK')"
        },
        "relationWithDivakar": {
          "type": "STRING",
          "description": "Relation with Boss DK (e.g. 'Self', 'Best Friend', 'Brother', 'Colleague')"
        },
        "role": {
          "type": "STRING",
          "description": "Role permission level: 'boss' (Full Root Access) | 'family' | 'friend' | 'guest'"
        }
      },
      "required": [
        "pin",
        "name",
        "relationWithDivakar"
      ]
    }
  },
  {
    "name": "record_voice_calibration_sample",
    "description": "Record a spoken calibration phrase for active voice biometric enrollment session.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "sessionId": {
          "type": "STRING",
          "description": "Active enrollment session ID returned from start_voice_enrollment"
        },
        "spokenPhrase": {
          "type": "STRING",
          "description": "The sentence spoken by the user"
        }
      },
      "required": [
        "sessionId"
      ]
    }
  },
  {
    "name": "list_voice_profiles",
    "description": "List all enrolled biometric voice profiles and their role privileges.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "delete_voice_profile",
    "description": "Delete an enrolled voice profile. Requires Boss's Voice PIN.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "pin": {
          "type": "STRING",
          "description": "Boss's secret Voice PIN"
        },
        "profileId": {
          "type": "STRING",
          "description": "Optional specific profile ID to delete. Omit to delete all."
        }
      },
      "required": [
        "pin"
      ]
    }
  },
  {
    "name": "update_voice_pin",
    "description": "Update Boss's master Voice Authentication PIN.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "newPin": {
          "type": "STRING",
          "description": "New 4-6 digit numeric PIN"
        }
      },
      "required": [
        "newPin"
      ]
    }
  },
  {
    "name": "play_youtube_music",
    "description": "PRIMARY DEFAULT MUSIC TOOL (YOUTUBE PRO SAFE): Play and stream pure background audio with high-res artwork from YouTube whenever DK asks to listen to music or songs (e.g. 'desi boys gana chalao', 'Kesariya sunao', 'music bajao', 'Arijit ke gane', 'gana chalao'). This is the DEFAULT engine.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "songName": {
          "type": "STRING",
          "description": "Song name, artist name, or query to play"
        }
      },
      "required": [
        "songName"
      ]
    }
  },
  {
    "name": "play_music",
    "description": "JIOSAAVN MUSIC TOOL: Play from JioSaavn ONLY when DK explicitly mentions 'JioSaavn' or 'Jio Saavn' (e.g. 'JioSaavn par Kesariya chalao', 'JioSaavn se gana bajao').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "songName": {
          "type": "STRING",
          "description": "Song name or artist name to play on JioSaavn"
        }
      },
      "required": [
        "songName"
      ]
    }
  },
  {
    "name": "stop_music",
    "description": "Stop and close the currently playing music immediately when DK says 'stop', 'gana band karo', 'mujhe achha nahi laga', 'band karo gana', 'gana nahi sunna mujhe'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "pause_music",
    "description": "Pause the currently playing song when DK says 'gana pause karo', 'thodi der roko', 'hold karo gana', 'pause music', 'ek minute roko'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "resume_music",
    "description": "Resume or continue playing the paused music track when DK says 'gana resume karo', 'gana continue karo', 'phir se chalao', 'play karo', 'unpause karo', 'gana chalu karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "control_music",
    "description": "FULL VOICE MUSIC CONTROLLER: Perform any playback or sound control on currently playing music when DK asks (e.g. '10 second aage karo', '10s peeche karo', 'shuru se bajao', 'awaz badhao', 'volume 80% karo', 'awaz kam karo', 'mute/unmute karo', 'agla gana chalao', 'pichhla gana', 'bass badhao', '8D audio lagao', 'vocal boost karo', 'lyrics dikhao').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "action": {
          "type": "STRING",
          "description": "Action to execute: 'seek_forward' (skip N seconds), 'seek_backward' (rewind N seconds), 'restart' (start from 0s), 'volume_up' (increase volume), 'volume_down' (decrease volume), 'set_volume' (set specific 0-100 level), 'next_song' (play next in queue), 'prev_song' (play previous in queue), 'set_bass' (boost bass 0-100), 'set_equalizer' (apply preset: 'bass_boost', 'vocal_clarity', '8d_spatial', 'party_punch', 'flat'), 'toggle_lyrics' (open/close lyrics)"
        },
        "value": {
          "type": "STRING",
          "description": "Optional value: seconds to seek (default 10), volume level (0-100), bass level (0-100), or equalizer preset name"
        }
      },
      "required": [
        "action"
      ]
    }
  },
  {
    "name": "preview_song_options",
    "description": "PLAY 30s AUDIO PREVIEWS FOR DISAMBIGUATION: Call this tool whenever DK says the currently playing song is wrong ('ye song nahi hai', 'ye nahi hai', 'galat song hai', 'wrong song', 'ye wala nahi dusra chalao', 'kuch aur sunna tha'). Fetches 3-5 matching candidate songs with 30s preview audio and opens the interactive preview modal.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Song title or keywords to search candidate previews for (e.g. 'Raanjhanaa', 'Main Sehra Bandh Ke', 'Tere Bina')"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "select_preview_option",
    "description": "CONTROL SONG PREVIEW: Next/previous candidate preview or confirm selection when DK speaks during song preview (e.g. 'next', 'agla wala', 'pichhla', 'previous', 'haan ye wala bajao', 'confirm', 'ye wala chalao').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "action": {
          "type": "STRING",
          "description": "'next' (play next preview), 'prev' (play previous preview), 'confirm' (launch selected full 320kbps song on JioSaavn), 'cancel'"
        },
        "index": {
          "type": "NUMBER",
          "description": "Optional 1-based index (e.g. 1, 2, 3)"
        },
        "songName": {
          "type": "STRING",
          "description": "Optional specific candidate song title to play"
        }
      },
      "required": [
        "action"
      ]
    }
  },
  {
    "name": "send_music_on_whatsapp",
    "description": "Find the real YouTube video link for a song and send it to DK's WhatsApp via Cloud API. If Cloud API fails and Baileys is disabled, inform DK and offer to enable Baileys as backup.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "songName": {
          "type": "STRING",
          "description": "Song name or artist name to find on YouTube (e.g. 'Kesariya Arijit Singh', 'Tum Hi Ho', 'Shape of You Ed Sheeran')"
        },
        "targetPhone": {
          "type": "STRING",
          "description": "Optional: phone number or contact name to send to. If not provided, sends to DK's own WhatsApp number."
        }
      },
      "required": [
        "songName"
      ]
    }
  },
  {
    "name": "toggle_baileys_system",
    "description": "Turn the Baileys (unofficial WhatsApp) system ON or OFF. Primary WhatsApp is Cloud API. Baileys is backup only. Call when DK says 'Baileys on/off karo', 'purana WhatsApp on karo', 'Baileys band karo', 'backup WhatsApp on karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "action": {
          "type": "STRING",
          "description": "'on' to enable Baileys, 'off' to disable Baileys, 'status' to check current state"
        }
      },
      "required": [
        "action"
      ]
    }
  },
  {
    "name": "dispatch_bug_to_code_agent",
    "description": "Send a bug report, broken service, error logs, or feature fix instruction directly to the Friday Coding Agent to automatically diagnose, write the fix, and create a Pull Request / commit. Call this whenever DK asks or approves fixing a broken service or feature.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "problemTitle": {
          "type": "STRING",
          "description": "Short title of the problem or broken service (e.g. 'Fix YouTube scraper timeout', 'Instagram scraper returning empty results')"
        },
        "serviceName": {
          "type": "STRING",
          "description": "Name of the service, file, or tool that failed"
        },
        "errorDetails": {
          "type": "STRING",
          "description": "The exact error message, logs, or diagnostic details"
        },
        "instruction": {
          "type": "STRING",
          "description": "Detailed instruction for the coding agent explaining what to investigate and fix"
        }
      },
      "required": [
        "instruction"
      ]
    }
  },
  {
    "name": "rollback_last_code_change",
    "description": "1-Click Undo / Rollback the latest commit made to the repository. Call when DK says 'aakhri code change rollback karo', 'purana code wapas lao', 'last commit undo karo', 'revert changes'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_pending_code_agent_request",
    "description": "Check if the Friday Coding Agent has prepared a plan and is currently waiting for DK's approval or permission to edit files.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "approve_and_commit_code_agent",
    "description": "Approve the pending Coding Agent plan and commit/push the changes directly to the main origin branch. Call when DK says 'Coding agent ko bolo ki code main branch me commit kar do', 'Approve kar do', 'Main me push kar do', 'Code commit karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "requestId": {
          "type": "STRING",
          "description": "Optional: Request ID to approve. If not provided, approves the latest pending request."
        }
      },
      "required": []
    }
  },
  {
    "name": "deny_code_agent_request",
    "description": "Deny or cancel the pending Coding Agent request. Call when DK says 'Nahi mat karo', 'Deny kar do', 'Coding agent roko', 'Cancel kar do'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "requestId": {
          "type": "STRING",
          "description": "Optional: Request ID to deny. If not provided, denies the latest pending request."
        }
      },
      "required": []
    }
  },
  {
    "name": "search_and_explain_codebase",
    "description": "Explore the codebase, search for functions/features, and explain where logic lives. Call when DK asks 'WhatsApp reply kis file me hai?', 'background sync ka code kahan hai?', 'explain the auth architecture'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "The feature, function, or concept to search for in the codebase"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "clean_project_codebase",
    "description": "Run autonomous codebase cleanup to remove unused imports, dead comments, and format code. Call when DK says 'codebase clean karo', 'dead code hatao', 'unused imports clean karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "crawl_and_extract_webpage",
    "description": "Crawl and inspect any target website URL, convert the webpage into clean LLM-friendly Markdown, extract data, and answer questions or summarize it. Call when DK says 'Is website ko crawl karo', 'Is link ka data dekho', 'Is page ko padh kar batao kya likha hai', 'URL crawl karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "url": {
          "type": "STRING",
          "description": "The full website URL to crawl and read (e.g. 'https://example.com' or 'example.com')"
        },
        "query": {
          "type": "STRING",
          "description": "Optional question or extraction goal (e.g. 'What are the pricing tiers?', 'Summarize key features', 'Extract contact email')"
        }
      },
      "required": [
        "url"
      ]
    }
  },
  {
    "name": "deep_crawl_website",
    "description": "Perform a multi-page deep crawl across an entire domain or website hierarchy, extracting combined markdown intelligence. Call when DK says 'Puri website deep crawl karo', 'Is domain ke sare pages crawl karke summary do'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "url": {
          "type": "STRING",
          "description": "The root website URL to deep crawl"
        },
        "maxPages": {
          "type": "NUMBER",
          "description": "Maximum pages to crawl (default 5, max 15)"
        },
        "query": {
          "type": "STRING",
          "description": "Optional research query to answer from the crawled site"
        }
      },
      "required": [
        "url"
      ]
    }
  },
  {
    "name": "search_telegram_media_vault",
    "description": "Search and retrieve full intelligence about any photo, video, PDF document, voice recording, or file shared in Telegram Media Groups or chats (finds exact date, group location, file size, duration, OCR text, and visual breakdown). Call when DK says 'Media group me jo invoice/photo aayi thi wo kahan hai?', 'Kal ka video kitne MB ka tha?', 'Voice note me kya bola gaya tha?', 'Telegram media search karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Search query (e.g. 'electricity bill', 'React video', '24 august invoice', 'voice recording')"
        },
        "mediaType": {
          "type": "STRING",
          "description": "Optional media type filter: 'photo', 'video', 'document', 'voice', 'audio', or 'all'"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_telegram_user_or_group_summary",
    "description": "Retrieve comprehensive conversational history, username profile, and summary of what was discussed with a specific Telegram user (1v1 chat) or inside a Telegram group. Call when DK says 'Rahul ke sath Telegram pe kya baat hui thi?', 'DK Project group me kya chal raha hai?', 'Telegram group summary batao', 'Telegram user ka update do'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "target": {
          "type": "STRING",
          "description": "Username (e.g. '@rahul_dev'), Person Name (e.g. 'Rahul'), or Group Name (e.g. 'DK Project Group')"
        },
        "isGroup": {
          "type": "BOOLEAN",
          "description": "Set to true if target is a group, false if user"
        }
      },
      "required": [
        "target"
      ]
    }
  },
  {
    "name": "analyze_youtube_video",
    "description": "Analyze, extract timestamps, and summarize any YouTube video URL or ID. Explains the entire narrative, lessons, and chapter timeline. Call when DK says 'Is YouTube video ki summary batao', 'Video me kya bataya gaya hai?', 'YouTube video analyze karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "url": {
          "type": "STRING",
          "description": "YouTube video URL or Video ID"
        }
      },
      "required": [
        "url"
      ]
    }
  },
  {
    "name": "ask_youtube_video_timestamp",
    "description": "Ask Gemini for YouTube: Find exact timestamps and answers to specific questions about what happens, what code is written, or what was said at what minute in a YouTube video. Call when DK says 'Video me authentication kitne minute par samjhaya hai?', '05:30 par kya bola?', 'Pricing ke baare me kab baat hui?'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "url": {
          "type": "STRING",
          "description": "YouTube video URL or Video ID"
        },
        "question": {
          "type": "STRING",
          "description": "Specific question about the video contents"
        }
      },
      "required": [
        "url",
        "question"
      ]
    }
  },
  {
    "name": "get_whatsapp_photo_or_doc_info",
    "description": "Analyze and explain what is inside the latest Photo, Image, or Document (PDF) received on WhatsApp (visual scene, people, objects, OCR text, key numbers). Call when DK says 'Photo me kya hai?', 'PDF me kya likha hai?', 'WhatsApp pe jo photo bheja hai dekho'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Optional specific question about the photo or document"
        }
      },
      "required": []
    }
  },
  {
    "name": "save_person_visual_memory",
    "description": "Save a person's photo, name, and visual biometric face traits into Firestore permanent memory so Friday can recognize them anytime in the future. Call when DK says 'Iska naam Rahul hai yaad rakhna', 'Ye photo Rahul ki hai save kar lo', 'Inka naam Rahul hai'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "name": {
          "type": "STRING",
          "description": "Person's name (e.g. 'Rahul', 'Amit', 'Priya')"
        },
        "relation": {
          "type": "STRING",
          "description": "Relationship or context (e.g. 'Friend', 'Brother', 'Colleague', 'College Friend')"
        },
        "notes": {
          "type": "STRING",
          "description": "Any additional notes or details about the person"
        }
      },
      "required": [
        "name"
      ]
    }
  },
  {
    "name": "identify_person_in_whatsapp_photo",
    "description": "Identify and recognize who is in the photo by comparing facial features against saved person profiles in Firestore memory. Call when DK says 'Pehchano ye photo me kaun hai?', 'Photo me kaun hai dekho', 'Pehchano kaun hai ye'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "toggle_ui_setting",
    "description": "Turn ON or OFF any UI toggle switch, panel, or modal by voice (e.g. captions, accurate_mode, google_search, wake_word, baileys_whatsapp, code_agent, chat_history, settings, whatsapp_modal).",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "settingName": {
          "type": "STRING",
          "description": "Name of the setting/toggle: 'captions', 'accurate_mode', 'google_search', 'wake_word', 'baileys_whatsapp', 'code_agent', 'chat_history', 'settings', 'whatsapp_modal'"
        },
        "state": {
          "type": "BOOLEAN",
          "description": "true for ON, false for OFF. If omitted, flips/toggles the current state."
        }
      },
      "required": [
        "settingName"
      ]
    }
  },
  {
    "name": "verify_voice_authorization_pin",
    "description": "MANDATORY STEP 1: Verify if the user's spoken voice authorization password/PIN matches the secret PIN in Firestore. MUST ALWAYS BE CALLED IMMEDIATELY whenever a user speaks or provides a PIN before asking for phrase or name.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "pin": {
          "type": "STRING",
          "description": "The exact 4-8 digit numeric PIN spoken by the user"
        }
      },
      "required": [
        "pin"
      ]
    }
  },
  {
    "name": "setup_boss_voice_recognition",
    "description": "Enroll and calibrate a voice recognition profile into Firestore. Requires authorization PIN verified from Firestore. Supports up to 5 profiles. Call during voice calibration after obtaining PIN, phrase, name, and relation with Divakar.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "pin": {
          "type": "STRING",
          "description": "Authorization PIN provided by speaker (verified against Firestore)"
        },
        "name": {
          "type": "STRING",
          "description": "Name of the person being enrolled (e.g. 'Divakar', 'Rohit', 'Pooja', 'Mummy')"
        },
        "relationWithDivakar": {
          "type": "STRING",
          "description": "Relation with Divakar/DK (e.g. 'Boss (Self)', 'Dost', 'Bhai', 'Behen', 'Mummy', 'Colleague')"
        },
        "spokenPhrase": {
          "type": "STRING",
          "description": "Calibration phrase spoken during enrollment"
        }
      },
      "required": [
        "pin",
        "name"
      ]
    }
  },
  {
    "name": "delete_boss_voice_recognition",
    "description": "Delete an enrolled voice profile from Firestore memory. Requires authorization PIN verified from Firestore. Call when user says 'voice delete karo', 'voice profile hatao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "pin": {
          "type": "STRING",
          "description": "Authorization PIN provided by user (verified against Firestore)"
        },
        "profileId": {
          "type": "STRING",
          "description": "Optional specific profile ID to delete"
        }
      },
      "required": [
        "pin"
      ]
    }
  },
  {
    "name": "get_coding_agent_status",
    "description": "Check what the Coding Agent is currently doing, whether any approval is pending, or if recent code was written, branch created, or committed/pushed to master. Call when DK asks 'Coding agent kya kar raha hai?', 'Kya koi approval maang raha hai?', 'Coding agent status kya hai?'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "approve_coding_agent_plan",
    "description": "Approve Coding Agent's proposed plan to generate code, create git branch, and apply changes. Call when DK says 'Approve kar do', 'Haan approve karo', 'Plan theek hai aage badho'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "requestId": {
          "type": "STRING",
          "description": "Optional specific request ID to approve. If omitted, approves latest pending request."
        }
      },
      "required": []
    }
  },
  {
    "name": "approve_and_commit_to_master",
    "description": "Approve Coding Agent plan, generate code, and immediately commit & push directly to master/main origin repository branch. Call when DK says 'Commit to master kar do', 'Master branch me push kar do', 'Main branch me daal do', 'Direct commit karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "requestId": {
          "type": "STRING",
          "description": "Optional specific request ID. If omitted, pushes latest pending request."
        }
      },
      "required": []
    }
  },
  {
    "name": "open_hologram_lab",
    "description": "Open the JARVIS Holographic 3D Hand Tracking & Machine Assembly Studio. Call when DK says '3D lab kholo', 'Hologram kholo', 'Design a drone / jet engine / arc reactor / robot arm / car', 'Structure banao', 'Air draw mode', 'Jarvis lab start karo', '3D model dikhao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "modelId": {
          "type": "STRING",
          "description": "Optional 3D model preset to load: 'arc_reactor', 'quadcopter_drone', 'jet_engine', 'robotic_arm', 'hypercar_chassis', or 'air_draw'"
        }
      },
      "required": []
    }
  },
  {
    "name": "reject_coding_agent_plan",
    "description": "Reject, deny, or stop the Coding Agent's task. Call when DK says 'Reject kar do', 'Deny karo', 'Roko', 'Nahi ye change mat karo', 'Task cancel karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "requestId": {
          "type": "STRING",
          "description": "Optional specific request ID to reject."
        }
      },
      "required": []
    }
  },
  {
    "name": "send_command_to_coding_agent",
    "description": "Dispatch a new bug fix, feature request, or codebase modification command directly to Coding Agent. Call when DK says 'Coding agent ko bolo ki [instruction]', 'Coding agent ko command do [command]', 'Ye feature add karne bolo coding agent ko'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "instruction": {
          "type": "STRING",
          "description": "The exact coding instruction or task description given by DK"
        },
        "problemTitle": {
          "type": "STRING",
          "description": "Short title summarizing the task (e.g. 'Add dark mode toggle', 'Fix login error')"
        }
      },
      "required": [
        "instruction"
      ]
    }
  },
  {
    "name": "send_telegram_message",
    "description": "Send a message or notification to Boss via Friday Telegram Bot. Call when DK says 'Telegram par message bhejo', 'Telegram pe link share karo', 'Telegram par notify karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "text": {
          "type": "STRING",
          "description": "Message text to send on Telegram"
        },
        "chatId": {
          "type": "STRING",
          "description": "Optional chat ID (defaults to OWNER chat if configured)"
        }
      },
      "required": [
        "text"
      ]
    }
  },
  {
    "name": "send_telegram_to_contact",
    "description": "Send a Telegram message to any person, contact name, username (@user), or Telegram group (e.g. 'Rahul ko telegram par good night bhej do', 'Telegram pe @rahul ko message bhejo', 'Telegram group Tech Squad me message bhejo'). Looks up contacts, known Telegram users, or group titles and delivers the message.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "recipient": {
          "type": "STRING",
          "description": "Contact Name, Telegram Username (e.g. '@rahul_dev'), Group Title (e.g. 'Tech Squad'), or Chat ID"
        },
        "message": {
          "type": "STRING",
          "description": "The message text to send"
        }
      },
      "required": [
        "recipient",
        "message"
      ]
    }
  },
  {
    "name": "get_telegram_bot_data",
    "description": "Retrieve all Telegram users and groups that are using or interacting with the Friday Telegram Bot. Call when DK asks 'Telegram par kaun kaun bot use kar raha hai', 'Telegram ke groups dikhao', 'Telegram activity status batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {}
    }
  },
  {
    "name": "get_telegram_chat_history",
    "description": "Retrieve message logs and conversations sent by users to Friday on Telegram, in personal DMs or in Telegram groups. Call when DK asks 'Telegram par kisne kya message bheja', 'Rahul ne telegram par kya bola tha', 'Telegram group me kya baatein hui', 'aaj Telegram par kya messages aaye'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "target": {
          "type": "STRING",
          "description": "Optional: 'all' (default), contact name, @username, or group title"
        },
        "limit": {
          "type": "NUMBER",
          "description": "Optional number of recent messages to return (default 20)"
        }
      }
    }
  },
  {
    "name": "modify_telegram_user",
    "description": "Modify or set a custom nickname/alias or notes for any Telegram user. Call when DK asks 'Telegram user Rahul ka nickname Bro kar do', 'is user ke notes update karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "target": {
          "type": "STRING",
          "description": "Telegram Username (e.g. '@rahul_dev'), Name, or User ID"
        },
        "customAlias": {
          "type": "STRING",
          "description": "Optional nickname or custom alias"
        },
        "customNotes": {
          "type": "STRING",
          "description": "Optional notes about this user"
        }
      },
      "required": [
        "target"
      ]
    }
  },
  {
    "name": "set_telegram_busy_message",
    "description": "Update the custom auto-reply busy status message for the Telegram Bot when people text while Boss is busy. Call when DK says 'Telegram bot par busy message change karo', 'auto-reply customize karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "message": {
          "type": "STRING",
          "description": "The new busy status / auto-reply message"
        }
      },
      "required": [
        "message"
      ]
    }
  },
  {
    "name": "send_instagram_dm",
    "description": "Send an Instagram Direct Message (DM) to any user, handle, or contact (e.g. 'Rahul ko Instagram par message bhej do', 'Instagram par @user ko DM karo'). Note: Sensitive actions cannot be performed via Instagram.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "recipient": {
          "type": "STRING",
          "description": "Instagram Username (e.g. '@rahul_dev', 'rahul_kumar'), Contact Name, or IGID"
        },
        "message": {
          "type": "STRING",
          "description": "The message text to send in Instagram DM"
        }
      },
      "required": [
        "recipient",
        "message"
      ]
    }
  },
  {
    "name": "scan_link_safety",
    "description": "Scan any URL/link for phishing, malware, cross-domain redirect risks, and SSL security. Call when DK says 'ye link safe hai kya', 'link scan karo', 'phishing check karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "url": {
          "type": "STRING",
          "description": "The URL or link to inspect"
        }
      },
      "required": [
        "url"
      ]
    }
  },
  {
    "name": "check_email_data_breach",
    "description": "Check if an email address or username has been exposed in major known public data breaches / dark web leaks. Call when DK says 'mera email leak to nahi hua', 'data breach check karo', 'email leak check'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "emailOrUsername": {
          "type": "STRING",
          "description": "Email address or username to check"
        }
      },
      "required": [
        "emailOrUsername"
      ]
    }
  },
  {
    "name": "audit_website_security",
    "description": "Perform comprehensive security audit on any domain/website: HTTP security headers (HSTS, CSP, X-Frame), DNS SPF/DMARC email security, SSL status, and overall security grade (A+ to F). Call when DK says 'website security check karo', 'domain audit karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "domain": {
          "type": "STRING",
          "description": "The domain name to audit (e.g. 'google.com', 'example.in')"
        }
      },
      "required": [
        "domain"
      ]
    }
  },
  {
    "name": "lookup_ip_intelligence",
    "description": "Lookup IP address or domain geolocation, ISP organization, ASN, coordinates, and hosting/cloud infrastructure threat intelligence. Call when DK says 'IP trace karo', 'is IP ka location batao'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "ipOrDomain": {
          "type": "STRING",
          "description": "IP address or domain to lookup"
        }
      },
      "required": [
        "ipOrDomain"
      ]
    }
  },
  {
    "name": "run_code_security_audit",
    "description": "Run Static Application Security Testing (SAST) on the project codebase to detect exposed hardcoded API keys, secrets, and insecure code patterns. Call when DK says 'code ka security audit karo', 'vulnerability scan karo'.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_linkedin_insights",
    "description": "Get LinkedIn company hub page and job opening search links for any company or skill.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Company name or job role (e.g. 'Google India', 'React Developer')"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_community_links",
    "description": "Get verified Telegram channels or Discord community search links for study, tech, gaming, or deals.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "platform": {
          "type": "STRING",
          "description": "'telegram' or 'discord'"
        },
        "topic": {
          "type": "STRING",
          "description": "Topic (e.g. 'deals india', 'python programming')"
        }
      },
      "required": [
        "platform",
        "topic"
      ]
    }
  },
  {
    "name": "get_pinterest_ideas",
    "description": "Get Pinterest visual ideas, room decor, setup aesthetics, and fashion trends.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Visual search topic (e.g. 'minimal desk setup', 'outfit ideas')"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "get_medicine_and_generic_info",
    "description": "Get medicine uses, dosage precautions, and 50-80% cheaper Jan Aushadhi generic salt alternatives for any medicine (e.g. 'Paracetamol', 'Pantop-D', 'Azithromycin').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "medicineName": {
          "type": "STRING",
          "description": "Medicine brand name or salt name"
        }
      },
      "required": [
        "medicineName"
      ]
    }
  },
  {
    "name": "get_daily_commodity_rates",
    "description": "Get latest Gold (22K/24K), Silver, Petrol, Diesel, and LPG cylinder rates in Patna, Delhi, or other Indian cities.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "commodity": {
          "type": "STRING",
          "description": "'gold', 'silver', 'petrol', 'diesel', 'lpg', or 'all'"
        },
        "city": {
          "type": "STRING",
          "description": "City name, default 'Patna' or 'Delhi'"
        }
      },
      "required": [
        "commodity"
      ]
    }
  },
  {
    "name": "get_emergency_helplines",
    "description": "Get instant emergency numbers (112 National, 100 Police, 102 Ambulance, 101 Fire, 1930 Cyber Fraud, 1091 Women Safety, 139 Railway).",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "serviceType": {
          "type": "STRING",
          "description": "Optional specific emergency type (e.g. 'cyber', 'women', 'police', 'medical')"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_vehicle_and_challan_services",
    "description": "Check e-Challan status/links, Parivahan RC/DL services, PUCC validity, and mParivahan portal links for vehicles.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "service": {
          "type": "STRING",
          "description": "'echallan', 'rc', 'dl', 'puc'"
        },
        "vehicleNumber": {
          "type": "STRING",
          "description": "Optional vehicle registration number (e.g. 'BR01AB1234')"
        }
      },
      "required": []
    }
  },
  {
    "name": "get_utility_and_bill_services",
    "description": "Get Gas cylinder WhatsApp booking numbers (Indane/Bharat/HP), Electricity bill portal links, and Fastag recharge services.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "serviceType": {
          "type": "STRING",
          "description": "'gas', 'electricity', 'fastag', or 'all'"
        },
        "providerOrState": {
          "type": "STRING",
          "description": "State or provider name (e.g. 'Bihar', 'Delhi', 'Indane')"
        }
      },
      "required": [
        "serviceType"
      ]
    }
  },
  {
    "name": "get_govt_scheme_info",
    "description": "Get details, eligibility, benefits, and official links for government schemes (e.g. 'Ayushman Bharat', 'PM Kisan', 'PMAY', 'Sukanya Samriddhi').",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "schemeName": {
          "type": "STRING",
          "description": "Name of the scheme (e.g. 'Ayushman Bharat', 'PM Kisan')"
        }
      },
      "required": [
        "schemeName"
      ]
    }
  },
  {
    "name": "track_expense_entry",
    "description": "Log a daily expense by voice with amount, category (Fuel, Food, Travel, Shopping, Bills), and optional note.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "amount": {
          "type": "NUMBER",
          "description": "Expense amount in Rupees (₹)"
        },
        "category": {
          "type": "STRING",
          "description": "Expense category (e.g. 'Petrol/Fuel', 'Food/Breakfast', 'Shopping', 'Travel', 'Bills')"
        },
        "note": {
          "type": "STRING",
          "description": "Optional note describing the expense"
        }
      },
      "required": [
        "amount",
        "category"
      ]
    }
  },
  {
    "name": "get_daily_expense_summary",
    "description": "Get total expense summary for today, recent logs, and spending breakdown.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_bus_travel_info",
    "description": "Get bus route info, travel time, and direct booking links for RedBus and AbhiBus between two cities.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "fromCity": {
          "type": "STRING",
          "description": "Departure city (e.g. 'Delhi', 'Patna')"
        },
        "toCity": {
          "type": "STRING",
          "description": "Destination city (e.g. 'Patna', 'Ranchi', 'Jaipur')"
        }
      },
      "required": [
        "fromCity",
        "toCity"
      ]
    }
  },
  {
    "name": "scan_wifi_networks",
    "description": "Scan and list all nearby WiFi networks (SSIDs, signal strength, security type, password required or not). Use when DK asks to see available WiFi, nearby hotspots, or wants to connect to a new network.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_wifi_status",
    "description": "Get the current WiFi connection status — which network is connected, signal strength, speed, and adapter info.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "connect_to_wifi",
    "description": "Connect to a specific WiFi network by SSID. Optionally provide the password if the network is secured. Use this when DK asks to connect to a WiFi network by name.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "ssid": {
          "type": "STRING",
          "description": "The WiFi network name (SSID) to connect to"
        },
        "password": {
          "type": "STRING",
          "description": "WiFi password, if the network requires one"
        }
      },
      "required": [
        "ssid"
      ]
    }
  },
  {
    "name": "disconnect_wifi",
    "description": "Disconnect from the current WiFi network.",
    "parameters": {
      "type": "OBJECT",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "execute_service",
    "description": "MANDATORY Indian Railways Intelligence via RailRadar: Get ticket prices & class-wise fares (SL, 3A, 2A, 1A, CC), real-time seat availability & Tatkal seats, coach layout (General/Sleeper aage ya peeche), live running status & GPS delay, 10-digit PNR status, train stoppage check, upcoming trains between any 2 stations (e.g. Jamui to Dholi/Patna), and cancellation refund rules. NEVER refuse ticket price or seat queries — ALWAYS call this tool.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "action": {
          "type": "STRING",
          "description": "Action type: 'ticket_price' (for fare/ticket prices/kiraya), 'seat_availability' (for seats/tatkal quota), 'coach_position' (for General/Sleeper/AC bogey position), 'stoppage_check' (to check if train stops at station), 'trains_between' (to search trains from one station/city to another), 'train_status' (live running status/delay/GPS), 'pnr_status' (10-digit PNR), 'schedule' (timetable), or 'cancellation_refund' (refund calculator)"
        },
        "query": {
          "type": "STRING",
          "description": "Train number (e.g. '12309', '12393'), 10-digit PNR (e.g. '2847291048'), station name (e.g. 'Jamui', 'Patna', 'Dholi'), or city query"
        },
        "fromStation": {
          "type": "STRING",
          "description": "Origin / From station name or code (e.g. 'Jamui', 'JMU', 'Patna', 'PNBE')"
        },
        "toStation": {
          "type": "STRING",
          "description": "Destination / To station name or code (e.g. 'Dholi', 'DOL', 'Delhi', 'NDLS')"
        },
        "targetStation": {
          "type": "STRING",
          "description": "Target station to check stoppage for (e.g. 'Prayagraj', 'Kanpur')"
        }
      },
      "required": [
        "action",
        "query"
      ]
    }
  },
  {
    "name": "change_voice",
    "description": "Change Friday's voice. Call when DK says 'male voice lagao', 'female voice lagao', 'ladke ki awaaz mein baat karo', 'Charon voice use karo', 'awaaz badlo', 'teri awaaz change kar', 'mujhe male/female voice chahiye'. This sends a signal to the frontend to switch the voice and restart the session with the new voice.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "gender": {
          "type": "STRING",
          "description": "Gender category: 'male' or 'female'. Use when DK says 'male voice', 'female voice', 'ladke ki awaaz', 'ladki ki awaaz'."
        },
        "voiceName": {
          "type": "STRING",
          "description": "Specific voice name (e.g. 'Charon', 'Puck', 'Sulafat', 'Aoede'). Use when DK mentions a specific voice name."
        },
        "style": {
          "type": "STRING",
          "description": "Voice style preference: 'warm', 'calm', 'upbeat', 'deep', 'soft', 'energetic', 'mature', 'youthful', 'smooth', 'firm'."
        }
      },
      "required": []
    }
  }
];
