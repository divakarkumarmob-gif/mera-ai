/**
 * Recipe & Food Intelligence Service
 * Powered by Spoonacular API (https://spoonacular.com/food-api/docs)
 * with robust TheMealDB & Friday's Internal Master Chef AI Learning Skill Fallback.
 */

import { GoogleGenAI } from "@google/genai";

export interface RecipeSearchResult {
  success: boolean;
  count: number;
  source: "spoonacular" | "themealdb" | "friday_ai_master_chef";
  recipes: RecipeSummary[];
  message?: string;
}

export interface RecipeSummary {
  id: string | number;
  title: string;
  image?: string;
  readyInMinutes?: number;
  servings?: number;
  sourceUrl?: string;
  summary?: string;
  cuisines?: string[];
  dishTypes?: string[];
  diets?: string[];
  calories?: number;
  protein?: string;
  carbs?: string;
  fat?: string;
  usedIngredientsCount?: number;
  missedIngredientsCount?: number;
  missedIngredients?: string[];
}

export interface DetailedRecipe {
  id: string | number;
  title: string;
  image?: string;
  readyInMinutes?: number;
  prepTimeMinutes?: number;
  servings?: number;
  sourceUrl?: string;
  summary?: string;
  cuisines?: string[];
  dishTypes?: string[];
  diets?: string[];
  vegetarian?: boolean;
  vegan?: boolean;
  glutenFree?: boolean;
  dairyFree?: boolean;
  healthScore?: number;
  pricePerServing?: number;
  extendedIngredients: {
    id?: number;
    name: string;
    original: string;
    amount?: number;
    unit?: string;
  }[];
  instructions?: string;
  analyzedInstructions?: {
    name?: string;
    steps: {
      number: number;
      step: string;
      ingredients?: { id: number; name: string }[];
      equipment?: { id: number; name: string }[];
    }[];
  }[];
  chefTips?: string[];
  nutrition?: {
    calories?: string;
    protein?: string;
    carbs?: string;
    fat?: string;
    nutrients?: { name: string; amount: number; unit: string }[];
  };
}

export class RecipeService {
  private getSpoonacularApiKey(): string | undefined {
    return (
      process.env.SPOONACULAR_API_KEY ||
      process.env.SPOONACULAR_KEY ||
      process.env.RECIPE_API_KEY ||
      process.env.FOOD_API_KEY
    );
  }

  private getGenAI(): GoogleGenAI | null {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }

  /**
   * 1. Search Recipes with Complex Filters (Query, Cuisine, Diet, Meal Type, Nutrition)
   */
  public async searchRecipes(options: {
    query?: string;
    cuisine?: string;
    diet?: string;
    type?: string;
    maxReadyTime?: number;
    minProtein?: number;
    maxCalories?: number;
    number?: number;
  }): Promise<RecipeSearchResult> {
    const apiKey = this.getSpoonacularApiKey();
    const limit = options.number || 5;

    // 1. Try Spoonacular API
    if (apiKey) {
      try {
        const params = new URLSearchParams({
          apiKey,
          number: String(limit),
          addRecipeInformation: "true",
          addRecipeNutrition: "true",
          instructionsRequired: "true",
        });

        if (options.query) params.append("query", options.query);
        if (options.cuisine) params.append("cuisine", options.cuisine);
        if (options.diet) params.append("diet", options.diet);
        if (options.type) params.append("type", options.type);
        if (options.maxReadyTime) params.append("maxReadyTime", String(options.maxReadyTime));
        if (options.minProtein) params.append("minProtein", String(options.minProtein));
        if (options.maxCalories) params.append("maxCalories", String(options.maxCalories));

        const res = await fetch(`https://api.spoonacular.com/recipes/complexSearch?${params.toString()}`, {
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const data = await res.json();
          const results = data.results || [];
          if (results.length > 0) {
            const recipes: RecipeSummary[] = results.map((r: any) => {
              const nut = r.nutrition?.nutrients || [];
              const cal = nut.find((n: any) => n.name === "Calories");
              const prot = nut.find((n: any) => n.name === "Protein");
              const carbs = nut.find((n: any) => n.name === "Carbohydrates");
              const fat = nut.find((n: any) => n.name === "Fat");

              return {
                id: r.id,
                title: r.title,
                image: r.image,
                readyInMinutes: r.readyInMinutes,
                servings: r.servings,
                sourceUrl: r.sourceUrl || r.spoonacularSourceUrl,
                summary: r.summary?.replace(/<[^>]*>/g, "").slice(0, 200) + "...",
                cuisines: r.cuisines,
                dishTypes: r.dishTypes,
                diets: r.diets,
                calories: cal?.amount,
                protein: prot ? `${prot.amount}${prot.unit}` : undefined,
                carbs: carbs ? `${carbs.amount}${carbs.unit}` : undefined,
                fat: fat ? `${fat.amount}${fat.unit}` : undefined,
              };
            });

            return {
              success: true,
              count: recipes.length,
              source: "spoonacular",
              recipes,
              message: `Boss, Spoonacular se ${recipes.length} recipes mil gayi hain.`,
            };
          }
        }
      } catch (e) {
        console.warn("[RecipeService] Spoonacular complexSearch fallback:", e);
      }
    }

    // 2. Try TheMealDB
    const mealDbRes = await this.searchTheMealDb(options.query || options.cuisine || "Paneer");
    if (mealDbRes.success && mealDbRes.recipes.length > 0) {
      return mealDbRes;
    }

    // 3. Fallback: Friday's AI Master Chef Learning Skill
    return this.synthesizeFridayChefSearch(options.query || options.cuisine || "Special Dish", options);
  }

  /**
   * 2. Search Recipes by Ingredients in Kitchen / Fridge
   */
  public async searchByIngredients(ingredients: string | string[], number = 5): Promise<RecipeSearchResult> {
    const apiKey = this.getSpoonacularApiKey();
    const ingList = Array.isArray(ingredients) ? ingredients.join(",") : ingredients;

    // 1. Try Spoonacular findByIngredients
    if (apiKey) {
      try {
        const params = new URLSearchParams({
          apiKey,
          ingredients: ingList,
          number: String(number),
          ranking: "1",
          ignorePantry: "true",
        });

        const res = await fetch(`https://api.spoonacular.com/recipes/findByIngredients?${params.toString()}`, {
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            const recipes: RecipeSummary[] = data.map((r: any) => ({
              id: r.id,
              title: r.title,
              image: r.image,
              usedIngredientsCount: r.usedIngredientCount,
              missedIngredientsCount: r.missedIngredientCount,
              missedIngredients: r.missedIngredients?.map((m: any) => m.original || m.name),
            }));

            return {
              success: true,
              count: recipes.length,
              source: "spoonacular",
              recipes,
              message: `Boss, aapke paas maujood ingredients (${ingList}) se ${recipes.length} recipes ban sakti hain!`,
            };
          }
        }
      } catch (e) {
        console.warn("[RecipeService] Spoonacular findByIngredients fallback:", e);
      }
    }

    // 2. Try TheMealDB
    const primaryIng = (Array.isArray(ingredients) ? ingredients[0] : ingredients.split(",")[0]).trim();
    const mealDbRes = await this.searchTheMealDbByIngredient(primaryIng);
    if (mealDbRes.success && mealDbRes.recipes.length > 0) {
      return mealDbRes;
    }

    // 3. Fallback: Friday's AI Master Chef Learning Skill
    return this.synthesizeFridayIngredientsRecipe(ingList);
  }

  /**
   * 3. Get Full Recipe Details, Ingredients List, and Step-by-Step Cooking Guide
   */
  public async getRecipeDetails(recipeIdOrTitle: string | number): Promise<{ success: boolean; recipe?: DetailedRecipe; message: string }> {
    const apiKey = this.getSpoonacularApiKey();

    // 1. Try Spoonacular if ID is numeric
    if (apiKey && typeof recipeIdOrTitle === "number") {
      try {
        const res = await fetch(
          `https://api.spoonacular.com/recipes/${recipeIdOrTitle}/information?apiKey=${apiKey}&includeNutrition=true`,
          { signal: AbortSignal.timeout(6000) }
        );

        if (res.ok) {
          const r = await res.json();
          const nut = r.nutrition?.nutrients || [];
          const cal = nut.find((n: any) => n.name === "Calories");
          const prot = nut.find((n: any) => n.name === "Protein");
          const carbs = nut.find((n: any) => n.name === "Carbohydrates");
          const fat = nut.find((n: any) => n.name === "Fat");

          const detailed: DetailedRecipe = {
            id: r.id,
            title: r.title,
            image: r.image,
            readyInMinutes: r.readyInMinutes,
            servings: r.servings,
            sourceUrl: r.sourceUrl || r.spoonacularSourceUrl,
            summary: r.summary?.replace(/<[^>]*>/g, ""),
            cuisines: r.cuisines,
            dishTypes: r.dishTypes,
            diets: r.diets,
            vegetarian: r.vegetarian,
            vegan: r.vegan,
            glutenFree: r.glutenFree,
            dairyFree: r.dairyFree,
            healthScore: r.healthScore,
            pricePerServing: r.pricePerServing ? Math.round(r.pricePerServing) / 100 : undefined,
            extendedIngredients: (r.extendedIngredients || []).map((i: any) => ({
              id: i.id,
              name: i.name,
              original: i.original,
              amount: i.amount,
              unit: i.unit,
            })),
            instructions: r.instructions?.replace(/<[^>]*>/g, ""),
            analyzedInstructions: r.analyzedInstructions,
            nutrition: {
              calories: cal ? `${cal.amount} ${cal.unit}` : undefined,
              protein: prot ? `${prot.amount} ${prot.unit}` : undefined,
              carbs: carbs ? `${carbs.amount} ${carbs.unit}` : undefined,
              fat: fat ? `${fat.amount} ${fat.unit}` : undefined,
              nutrients: nut.slice(0, 10),
            },
          };

          return {
            success: true,
            recipe: detailed,
            message: `Boss, "${r.title}" ki poori recipe aur step-by-step instructions ready hain!`,
          };
        }
      } catch (e) {
        console.warn("[RecipeService] Spoonacular getRecipeDetails fallback:", e);
      }
    }

    // 2. Try TheMealDB search
    const mealDbRes = await this.getTheMealDbDetails(String(recipeIdOrTitle));
    if (mealDbRes.success && mealDbRes.recipe) {
      return mealDbRes;
    }

    // 3. Fallback: Friday's AI Master Chef Learning Skill
    return this.synthesizeFridayChefRecipe(String(recipeIdOrTitle));
  }

  /**
   * 4. Get Random Recipes / Dish Recommendations (e.g. Vegetarian, Indian, Quick Dinner)
   */
  public async getRandomRecipes(tags?: string, number = 3): Promise<RecipeSearchResult> {
    const apiKey = this.getSpoonacularApiKey();

    if (apiKey) {
      try {
        const params = new URLSearchParams({
          apiKey,
          number: String(number),
        });
        if (tags) params.append("include-tags", tags);

        const res = await fetch(`https://api.spoonacular.com/recipes/random?${params.toString()}`, {
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const data = await res.json();
          const recipes: RecipeSummary[] = (data.recipes || []).map((r: any) => ({
            id: r.id,
            title: r.title,
            image: r.image,
            readyInMinutes: r.readyInMinutes,
            servings: r.servings,
            sourceUrl: r.sourceUrl,
            summary: r.summary?.replace(/<[^>]*>/g, "").slice(0, 200) + "...",
            cuisines: r.cuisines,
            dishTypes: r.dishTypes,
            diets: r.diets,
          }));

          return {
            success: true,
            count: recipes.length,
            source: "spoonacular",
            recipes,
            message: `Boss, aaj ke liye ye delicious random recipes suggest ki hain:`,
          };
        }
      } catch (e) {
        console.warn("[RecipeService] Spoonacular getRandomRecipes fallback:", e);
      }
    }

    const mealDbRes = await this.getRandomTheMealDb();
    if (mealDbRes.success && mealDbRes.recipes.length > 0) {
      return mealDbRes;
    }

    // Friday AI Chef fallback
    return this.synthesizeFridayChefSearch(tags ? `${tags} special dish` : "Indian dinner ideas");
  }

  /**
   * 5. Ingredient Substitutes (e.g. "What can I replace butter with?")
   */
  public async getIngredientSubstitutes(ingredientName: string): Promise<{ success: boolean; ingredient: string; substitutes: string[]; message: string }> {
    const apiKey = this.getSpoonacularApiKey();
    const cleanIng = ingredientName.trim();

    if (apiKey) {
      try {
        const res = await fetch(
          `https://api.spoonacular.com/food/ingredients/substitutes?apiKey=${apiKey}&ingredientName=${encodeURIComponent(cleanIng)}`,
          { signal: AbortSignal.timeout(5000) }
        );

        if (res.ok) {
          const data = await res.json();
          if (data.status === "success" && data.substitutes?.length > 0) {
            return {
              success: true,
              ingredient: cleanIng,
              substitutes: data.substitutes,
              message: data.message || `Boss, ${cleanIng} ki jagah aap ye use kar sakte hain:\n• ` + data.substitutes.join("\n• "),
            };
          }
        }
      } catch (e) {
        console.warn("[RecipeService] Spoonacular substitutes fallback:", e);
      }
    }

    // Friday AI Chef dynamic substitutes
    return this.synthesizeFridaySubstitutes(cleanIng);
  }

  /**
   * 6. Generate Meal Plan (Daily Calorie & Diet Goal)
   */
  public async generateMealPlan(options: {
    timeFrame?: "day" | "week";
    targetCalories?: number;
    diet?: string;
    exclude?: string;
  }): Promise<any> {
    const apiKey = this.getSpoonacularApiKey();
    const timeFrame = options.timeFrame || "day";
    const targetCalories = options.targetCalories || 2000;

    if (apiKey) {
      try {
        const params = new URLSearchParams({
          apiKey,
          timeFrame,
          targetCalories: String(targetCalories),
        });
        if (options.diet) params.append("diet", options.diet);
        if (options.exclude) params.append("exclude", options.exclude);

        const res = await fetch(`https://api.spoonacular.com/mealplanner/generate?${params.toString()}`, {
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const data = await res.json();
          return {
            success: true,
            source: "spoonacular",
            timeFrame,
            targetCalories,
            nutrients: data.nutrients,
            meals: data.meals || data.week,
            message: `Boss, ${targetCalories} kcal ka ${timeFrame} meal plan generate kar diya hai!`,
          };
        }
      } catch (e) {
        console.warn("[RecipeService] Spoonacular generateMealPlan fallback:", e);
      }
    }

    // Friday AI Chef meal planner
    return this.synthesizeFridayMealPlan(targetCalories, timeFrame, options.diet);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Friday's AI Master Chef Learning Skill (Deep AI Recipe Synthesizer)
  // ──────────────────────────────────────────────────────────────────────────

  private async synthesizeFridayChefRecipe(dishName: string): Promise<{ success: boolean; recipe?: DetailedRecipe; message: string }> {
    const ai = this.getGenAI();
    if (!ai) {
      return {
        success: false,
        message: `Boss, "${dishName}" ki details fetch karne ke liye connection temporarily busy hai.`,
      };
    }

    try {
      const prompt = `You are Chef Friday, an expert Master Chef with deep culinary expertise in Indian, Asian, and Global cuisines.
Generate an authentic, gourmet, step-by-step recipe for the dish: "${dishName}".

Respond ONLY with valid JSON in this exact structure:
{
  "title": "${dishName}",
  "cuisine": "Indian / Mughlai / Continental / etc",
  "prepTimeMinutes": 15,
  "readyInMinutes": 30,
  "servings": 3,
  "summary": "Short 2-line delicious description of the dish",
  "vegetarian": true/false,
  "extendedIngredients": [
    {"name": "Paneer", "original": "250g Paneer (cubed)"},
    {"name": "Tomato Puree", "original": "2 medium Tomatoes (pureed)"},
    {"name": "Kasuri Methi", "original": "1 tsp Kasuri Methi (crushed)"}
  ],
  "steps": [
    "Step 1: Pan me 2 tbsp ghee garam karein aur jeera tadkayein.",
    "Step 2: Pyaaz aur adrak-lahsun paste daal kar golden brown hone tak bhunein.",
    "Step 3: Tamatar puree aur masale daal kar tel chhootne tak pakayein.",
    "Step 4: Paneer cubes daal kar 5 minute dheemi aanch par simmer karein aur hara dhaniya se garnish karein."
  ],
  "chefTips": [
    "Kasuri methi ko haath se crush karke aakhri me daalne se hotel jaisa aroma aata hai."
  ],
  "nutrition": {
    "calories": "320 kcal per serving",
    "protein": "16g",
    "carbs": "12g",
    "fat": "22g"
  }
}`;

      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.3,
        },
      });

      const parsed = JSON.parse(res.text || "{}");
      if (parsed.title) {
        const recipe: DetailedRecipe = {
          id: `friday_chef_${Date.now()}`,
          title: parsed.title,
          readyInMinutes: parsed.readyInMinutes || 30,
          prepTimeMinutes: parsed.prepTimeMinutes || 15,
          servings: parsed.servings || 3,
          summary: parsed.summary,
          cuisines: parsed.cuisine ? [parsed.cuisine] : ["Gourmet"],
          vegetarian: parsed.vegetarian ?? true,
          extendedIngredients: (parsed.extendedIngredients || []).map((i: any) => ({
            name: i.name,
            original: i.original,
          })),
          instructions: (parsed.steps || []).join("\n"),
          analyzedInstructions: [
            {
              name: "Cooking Steps",
              steps: (parsed.steps || []).map((s: string, idx: number) => ({
                number: idx + 1,
                step: s,
              })),
            },
          ],
          chefTips: parsed.chefTips || [],
          nutrition: parsed.nutrition,
        };

        return {
          success: true,
          recipe,
          message: `Boss, Friday ke Master Chef AI Skill ne "${parsed.title}" ki authentic recipe तैयार kar di hai! 👨‍🍳✨`,
        };
      }
    } catch (e) {
      console.warn("[RecipeService] Friday AI chef recipe synthesis failed:", e);
    }

    return {
      success: false,
      message: `Boss, "${dishName}" ki recipe banate waqt connection timeout ho gaya.`,
    };
  }

  private static readonly CURATED_CHEF_RECIPES: Record<string, RecipeSummary[]> = {
    paneer: [
      {
        id: "curated_paneer_tikka",
        title: "Tandoori Paneer Tikka",
        readyInMinutes: 30,
        servings: 4,
        cuisines: ["North Indian", "Tandoori"],
        summary: "Marinated cottage cheese cubes grilled with capsicum, onion, and yogurt-based tandoori spices.",
        calories: 320,
        protein: "18g",
      },
      {
        id: "curated_paneer_butter_masala",
        title: "Restaurant-Style Paneer Butter Masala",
        readyInMinutes: 35,
        servings: 4,
        cuisines: ["Mughlai", "North Indian"],
        summary: "Rich, creamy makhani gravy prepared with ripe tomatoes, cashews, butter, and tender paneer.",
        calories: 380,
        protein: "16g",
      },
    ],
    biryani: [
      {
        id: "curated_veg_dum_biryani",
        title: "Hyderabadi Veg Dum Biryani",
        readyInMinutes: 45,
        servings: 4,
        cuisines: ["Hyderabadi", "Indian"],
        summary: "Fragrant basmati rice layered with spiced vegetables, saffron milk, mint, and slow-cooked in dum style.",
        calories: 420,
        protein: "11g",
      },
    ],
    dal: [
      {
        id: "curated_dal_tadka",
        title: "Dhaba Style Dal Tadka",
        readyInMinutes: 25,
        servings: 3,
        cuisines: ["North Indian"],
        summary: "Yellow toor dal tempered with desi ghee, cumin, garlic, and whole red chillies.",
        calories: 210,
        protein: "12g",
      },
    ],
  };

  private async synthesizeFridayChefSearch(query: string, options?: any): Promise<RecipeSearchResult> {
    const ai = this.getGenAI();
    if (ai) {
      try {
        const prompt = `You are Chef Friday. Give 3 delicious recipe recommendations matching query: "${query}".
Cuisine/Diet filter: ${options?.cuisine || options?.diet || "any"}.

Respond ONLY with valid JSON in this structure:
{
  "recipes": [
    {
      "title": "Dish Name",
      "readyInMinutes": 25,
      "servings": 3,
      "cuisines": ["Indian"],
      "summary": "Delicious spicy dish...",
      "calories": 280,
      "protein": "14g"
    }
  ]
}`;

        const models = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"];
        for (const model of models) {
          try {
            const res = await ai.models.generateContent({
              model,
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              config: {
                responseMimeType: "application/json",
                temperature: 0.4,
              },
            });

            const parsed = JSON.parse(res.text || "{}");
            if (Array.isArray(parsed.recipes) && parsed.recipes.length > 0) {
              const list: RecipeSummary[] = parsed.recipes.map((r: any, idx: number) => ({
                id: `friday_rec_${Date.now()}_${idx}`,
                title: r.title,
                readyInMinutes: r.readyInMinutes || 30,
                servings: r.servings || 3,
                summary: r.summary,
                cuisines: r.cuisines || ["Delicious"],
                calories: r.calories,
                protein: r.protein,
              }));

              return {
                success: true,
                count: list.length,
                source: "friday_ai_master_chef",
                recipes: list,
                message: `Boss, Friday ke Master Chef AI Skill ne "${query}" ke liye ${list.length} top recipes suggest ki hain!`,
              };
            }
          } catch {}
        }
      } catch (e) {
        console.warn("[RecipeService] Gemini Chef search note:", e);
      }
    }

    // Curated Culinary Chef Knowledgebase Fallback
    const qLow = query.toLowerCase();
    for (const [key, recipes] of Object.entries(RecipeService.CURATED_CHEF_RECIPES)) {
      if (qLow.includes(key)) {
        return {
          success: true,
          count: recipes.length,
          source: "friday_ai_master_chef",
          recipes,
          message: `Boss, Friday ke Master Chef cookbook se "${query}" ki authentic recipes mil gayi hain!`,
        };
      }
    }

    // Default Chef recommendation if specific key not matched
    const defaultRec: RecipeSummary = {
      id: "chef_special_" + Date.now(),
      title: `${query.charAt(0).toUpperCase() + query.slice(1)} Special`,
      readyInMinutes: 30,
      servings: 3,
      cuisines: [options?.cuisine || "Chef Special"],
      summary: `Chef Friday's signature preparation for ${query} with balanced aromatics and freshly ground spices.`,
      calories: 320,
      protein: "14g",
    };

    return {
      success: true,
      count: 1,
      source: "friday_ai_master_chef",
      recipes: [defaultRec],
      message: `Boss, Friday Chef ne "${query}" ki authentic recommendation तैयार kar di hai!`,
    };
  }

  private async synthesizeFridayIngredientsRecipe(ingredients: string): Promise<RecipeSearchResult> {
    const ai = this.getGenAI();
    if (!ai) return { success: false, count: 0, source: "friday_ai_master_chef", recipes: [] };

    try {
      const prompt = `You are Chef Friday. A user has these ingredients in their kitchen: "${ingredients}".
Suggest 3 fantastic dishes they can cook right now with these ingredients, plus basic spices.

Respond ONLY with valid JSON:
{
  "recipes": [
    {
      "title": "Dish Name",
      "usedIngredientsCount": 3,
      "missedIngredientsCount": 1,
      "missedIngredients": ["optional coriander"],
      "summary": "Quick tasty dish you can make in 20 mins"
    }
  ]
}`;

      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.3,
        },
      });

      const parsed = JSON.parse(res.text || "{}");
      const list = (parsed.recipes || []).map((r: any, idx: number) => ({
        id: `friday_ing_${Date.now()}_${idx}`,
        title: r.title,
        usedIngredientsCount: r.usedIngredientsCount,
        missedIngredientsCount: r.missedIngredientsCount,
        missedIngredients: r.missedIngredients,
        summary: r.summary,
      }));

      return {
        success: list.length > 0,
        count: list.length,
        source: "friday_ai_master_chef",
        recipes: list,
        message: `Boss, aapke maujood ingredients (${ingredients}) se Friday AI ne ${list.length} recipes banayi hain!`,
      };
    } catch {
      return { success: false, count: 0, source: "friday_ai_master_chef", recipes: [] };
    }
  }

  private async synthesizeFridaySubstitutes(ingredient: string): Promise<{ success: boolean; ingredient: string; substitutes: string[]; message: string }> {
    const ai = this.getGenAI();
    if (!ai) {
      return {
        success: false,
        ingredient,
        substitutes: [],
        message: `Boss, "${ingredient}" ka substitute find nahi ho paya.`,
      };
    }

    try {
      const prompt = `You are Chef Friday. Give 3-4 exact cooking/baking substitutes for the ingredient: "${ingredient}". Include ratio/quantity (e.g. 1 cup butter = 3/4 cup oil or 1/2 cup Greek yogurt).

Respond ONLY with valid JSON:
{
  "substitutes": [
    "Refined Oil / Ghee (1:1 ratio for cooking/baking)",
    "Greek Yogurt / Curd (1/2 cup per 1 cup butter for moisture in cakes)",
    "Mashed Banana / Applesauce (for healthy eggless baking)"
  ]
}`;

      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      });

      const parsed = JSON.parse(res.text || "{}");
      const subs: string[] = parsed.substitutes || [];

      return {
        success: subs.length > 0,
        ingredient,
        substitutes: subs,
        message: `Boss, Friday Chef AI ke mutabiq "${ingredient}" ke best substitutes:\n• ` + subs.join("\n• "),
      };
    } catch {
      return {
        success: false,
        ingredient,
        substitutes: [],
        message: `Boss, "${ingredient}" ka direct substitute exact match nahi mila.`,
      };
    }
  }

  private async synthesizeFridayMealPlan(targetCalories: number, timeFrame: string, diet?: string): Promise<any> {
    const ai = this.getGenAI();
    if (!ai) {
      return {
        success: true,
        source: "friday_ai_master_chef",
        timeFrame,
        targetCalories,
        nutrients: { calories: targetCalories, protein: "75g", carbs: "220g", fat: "55g" },
        meals: [
          { slot: 1, title: "Healthy Oats / Poha with Sprouted Moong & Green Tea", readyInMinutes: 15 },
          { slot: 2, title: "Dal Tadka, Roti, Paneer Bhurji with Green Salad", readyInMinutes: 30 },
          { slot: 3, title: "Roasted Makhana & Fresh Fruit Bowl", readyInMinutes: 5 },
          { slot: 4, title: "Light Khichdi / Vegetable Stir Fry with Soup", readyInMinutes: 25 },
        ],
        message: `Boss, ${targetCalories} kcal ka healthy meal plan ready hai!`,
      };
    }

    try {
      const prompt = `You are Chef Friday. Create a high-nutrition, delicious ${timeFrame} meal plan with target calories: ${targetCalories} kcal. Diet preference: ${diet || "Indian Balanced"}.

Respond ONLY with valid JSON:
{
  "nutrients": {"calories": ${targetCalories}, "protein": "85g", "carbs": "210g", "fat": "60g"},
  "meals": [
    {"slot": 1, "name": "Breakfast", "title": "...", "readyInMinutes": 15, "calories": 400},
    {"slot": 2, "name": "Lunch", "title": "...", "readyInMinutes": 30, "calories": 700},
    {"slot": 3, "name": "Snack", "title": "...", "readyInMinutes": 10, "calories": 250},
    {"slot": 4, "name": "Dinner", "title": "...", "readyInMinutes": 25, "calories": 650}
  ]
}`;

      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.3,
        },
      });

      const parsed = JSON.parse(res.text || "{}");
      return {
        success: true,
        source: "friday_ai_master_chef",
        timeFrame,
        targetCalories,
        nutrients: parsed.nutrients || { calories: targetCalories },
        meals: parsed.meals || [],
        message: `Boss, Friday ke Master Chef AI Skill ne ${targetCalories} kcal ka customized ${diet || "balanced"} meal plan prepare kar diya hai! 🥗✨`,
      };
    } catch {
      return {
        success: true,
        source: "friday_ai_master_chef",
        timeFrame,
        targetCalories,
        nutrients: { calories: targetCalories },
        meals: [],
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TheMealDB Fallbacks (100% Free Public Food API)
  // ──────────────────────────────────────────────────────────────────────────

  private async searchTheMealDb(query: string): Promise<RecipeSearchResult> {
    try {
      const res = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        const meals = data.meals || [];
        if (meals.length > 0) {
          const recipes: RecipeSummary[] = meals.slice(0, 5).map((m: any) => ({
            id: m.idMeal,
            title: m.strMeal,
            image: m.strMealThumb,
            cuisines: m.strArea ? [m.strArea] : [],
            dishTypes: m.strCategory ? [m.strCategory] : [],
            sourceUrl: m.strSource || m.strYoutube,
            summary: m.strInstructions?.slice(0, 200) + "...",
          }));

          return {
            success: true,
            count: recipes.length,
            source: "themealdb",
            recipes,
            message: `Boss, TheMealDB se "${query}" ki ${recipes.length} recipes mil gayi hain.`,
          };
        }
      }
    } catch (e) {
      console.warn("[RecipeService] TheMealDB search fallback:", e);
    }

    return {
      success: false,
      count: 0,
      source: "friday_ai_master_chef",
      recipes: [],
      message: `Boss, "${query}" ke liye koi recipe nahi mili.`,
    };
  }

  private async searchTheMealDbByIngredient(ingredient: string): Promise<RecipeSearchResult> {
    try {
      const res = await fetch(`https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(ingredient)}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        const meals = data.meals || [];
        if (meals.length > 0) {
          const recipes: RecipeSummary[] = meals.slice(0, 5).map((m: any) => ({
            id: m.idMeal,
            title: m.strMeal,
            image: m.strMealThumb,
            usedIngredientsCount: 1,
          }));

          return {
            success: true,
            count: recipes.length,
            source: "themealdb",
            recipes,
            message: `Boss, "${ingredient}" se banne wali ${recipes.length} recipes mil gayi hain!`,
          };
        }
      }
    } catch (e) {
      console.warn("[RecipeService] TheMealDB ingredient fallback:", e);
    }

    return {
      success: false,
      count: 0,
      source: "friday_ai_master_chef",
      recipes: [],
    };
  }

  private async getTheMealDbDetails(queryOrId: string): Promise<{ success: boolean; recipe?: DetailedRecipe; message: string }> {
    try {
      const url = /^\d+$/.test(queryOrId)
        ? `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${queryOrId}`
        : `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(queryOrId)}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const m = data.meals?.[0];
        if (m) {
          const ingredients: { name: string; original: string }[] = [];
          for (let i = 1; i <= 20; i++) {
            const ing = m[`strIngredient${i}`];
            const measure = m[`strMeasure${i}`];
            if (ing && ing.trim()) {
              ingredients.push({
                name: ing.trim(),
                original: `${measure ? measure.trim() + " " : ""}${ing.trim()}`,
              });
            }
          }

          const detailed: DetailedRecipe = {
            id: m.idMeal,
            title: m.strMeal,
            image: m.strMealThumb,
            cuisines: m.strArea ? [m.strArea] : [],
            dishTypes: m.strCategory ? [m.strCategory] : [],
            sourceUrl: m.strSource || m.strYoutube,
            summary: m.strInstructions?.slice(0, 200) + "...",
            extendedIngredients: ingredients,
            instructions: m.strInstructions,
          };

          return {
            success: true,
            recipe: detailed,
            message: `Boss, "${m.strMeal}" ki poori recipe mil gayi hai!`,
          };
        }
      }
    } catch (e) {
      console.warn("[RecipeService] TheMealDB details fallback:", e);
    }

    return {
      success: false,
      message: `Boss, "${queryOrId}" ki details nahi mil saki.`,
    };
  }

  private async getRandomTheMealDb(): Promise<RecipeSearchResult> {
    try {
      const res = await fetch("https://www.themealdb.com/api/json/v1/1/random.php", { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const m = data.meals?.[0];
        if (m) {
          return {
            success: true,
            count: 1,
            source: "themealdb",
            recipes: [
              {
                id: m.idMeal,
                title: m.strMeal,
                image: m.strMealThumb,
                cuisines: m.strArea ? [m.strArea] : [],
                dishTypes: m.strCategory ? [m.strCategory] : [],
                sourceUrl: m.strSource || m.strYoutube,
                summary: m.strInstructions?.slice(0, 200) + "...",
              },
            ],
            message: `Boss, aaj ke liye recommend ki gayi dish: "${m.strMeal}" (${m.strArea || "Delicious"})`,
          };
        }
      }
    } catch (e) {
      console.warn("[RecipeService] TheMealDB random fallback:", e);
    }

    return {
      success: false,
      count: 0,
      source: "friday_ai_master_chef",
      recipes: [],
      message: "Random recipe fetch nahi ho payi.",
    };
  }
}

export const recipeService = new RecipeService();
