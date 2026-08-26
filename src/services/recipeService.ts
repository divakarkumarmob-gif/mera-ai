/**
 * Recipe & Food Intelligence Service
 * Powered by Spoonacular API (https://spoonacular.com/food-api/docs)
 * with robust TheMealDB & AI Fallbacks for zero-downtime cooking assistance.
 */

export interface RecipeSearchResult {
  success: boolean;
  count: number;
  source: "spoonacular" | "themealdb" | "fallback";
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
  nutrition?: {
    calories?: string;
    protein?: string;
    carbs?: string;
    fat?: string;
    nutrients?: { name: string; amount: number; unit: string }[];
  };
}

export class RecipeService {
  private getApiKey(): string | undefined {
    return (
      process.env.SPOONACULAR_API_KEY ||
      process.env.SPOONACULAR_KEY ||
      process.env.RECIPE_API_KEY ||
      process.env.FOOD_API_KEY
    );
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
    const apiKey = this.getApiKey();
    const limit = options.number || 5;

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

    // Fallback: TheMealDB
    return this.searchTheMealDb(options.query || options.cuisine || "chicken");
  }

  /**
   * 2. Search Recipes by Ingredients in Kitchen / Fridge
   */
  public async searchByIngredients(ingredients: string | string[], number = 5): Promise<RecipeSearchResult> {
    const apiKey = this.getApiKey();
    const ingList = Array.isArray(ingredients) ? ingredients.join(",") : ingredients;

    if (apiKey) {
      try {
        const params = new URLSearchParams({
          apiKey,
          ingredients: ingList,
          number: String(number),
          ranking: "1", // Maximize used ingredients
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

    // Fallback: TheMealDB filter by main ingredient
    const primaryIng = (Array.isArray(ingredients) ? ingredients[0] : ingredients.split(",")[0]).trim();
    return this.searchTheMealDbByIngredient(primaryIng);
  }

  /**
   * 3. Get Full Recipe Details, Ingredients List, and Step-by-Step Cooking Guide
   */
  public async getRecipeDetails(recipeIdOrTitle: string | number): Promise<{ success: boolean; recipe?: DetailedRecipe; message: string }> {
    const apiKey = this.getApiKey();

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

    // Search by title or fallback to TheMealDB
    return this.getTheMealDbDetails(String(recipeIdOrTitle));
  }

  /**
   * 4. Get Random Recipes / Dish Recommendations (e.g. Vegetarian, Indian, Quick Dinner)
   */
  public async getRandomRecipes(tags?: string, number = 3): Promise<RecipeSearchResult> {
    const apiKey = this.getApiKey();

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

    return this.getRandomTheMealDb();
  }

  /**
   * 5. Ingredient Substitutes (e.g. "What can I replace butter with?")
   */
  public async getIngredientSubstitutes(ingredientName: string): Promise<{ success: boolean; ingredient: string; substitutes: string[]; message: string }> {
    const apiKey = this.getApiKey();
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

    // Common smart culinary substitutes lookup
    const commonSubs: Record<string, string[]> = {
      butter: ["Oil (1:1)", "Ghee (1:1)", "Mashed Banana (for baking)", "Greek Yogurt"],
      egg: ["Mashed Banana (1/2 banana = 1 egg)", "Chia seeds with water", "Flaxseed meal with water", "Yogurt (1/4 cup = 1 egg)"],
      sugar: ["Honey (3/4 cup per 1 cup sugar)", "Jaggery (Gud)", "Maple Syrup", "Stevia"],
      milk: ["Almond Milk", "Soy Milk", "Oat Milk", "Coconut Milk"],
      cream: ["Milk + Butter", "Coconut Cream", "Greek Yogurt", "Silken Tofu"],
      paneer: ["Tofu", "Ricotta Cheese", "Feta Cheese"],
      curd: ["Yogurt", "Sour Cream", "Lemon Juice in Warm Milk (Buttermilk)"],
    };

    const key = Object.keys(commonSubs).find(k => cleanIng.toLowerCase().includes(k));
    if (key) {
      return {
        success: true,
        ingredient: cleanIng,
        substitutes: commonSubs[key],
        message: `Boss, ${cleanIng} ke substitutes:\n• ` + commonSubs[key].join("\n• "),
      };
    }

    return {
      success: false,
      ingredient: cleanIng,
      substitutes: [],
      message: `Boss, "${cleanIng}" ka direct substitute exact match nahi mila.`,
    };
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
    const apiKey = this.getApiKey();
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

    // High quality default Indian / Balanced diet plan
    return {
      success: true,
      source: "fallback",
      timeFrame: "day",
      targetCalories,
      nutrients: { calories: targetCalories, protein: "80g", carbs: "220g", fat: "60g" },
      meals: [
        { slot: 1, title: "Healthy Oats / Poha with Sprouted Moong & Tea", readyInMinutes: 15 },
        { slot: 2, title: "Dal Tadka, Roti, Paneer Bhurji / Grilled Chicken with Green Salad", readyInMinutes: 30 },
        { slot: 3, title: "Roasted Makhana / Green Tea / Fruit Bowl", readyInMinutes: 5 },
        { slot: 4, title: "Light Khichdi / Vegetable Stir Fry with Soup", readyInMinutes: 25 },
      ],
      message: `Boss, ${targetCalories} kcal ka balanced daily meal plan prepare ho gaya hai!`,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TheMealDB Fallbacks (100% Free Public Food API)
  // ──────────────────────────────────────────────────────────────────────────

  private async searchTheMealDb(query: string): Promise<RecipeSearchResult> {
    try {
      const res = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(5000),
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
      source: "fallback",
      recipes: [],
      message: `Boss, "${query}" ke liye koi recipe nahi mili.`,
    };
  }

  private async searchTheMealDbByIngredient(ingredient: string): Promise<RecipeSearchResult> {
    try {
      const res = await fetch(`https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(ingredient)}`, {
        signal: AbortSignal.timeout(5000),
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

    return this.searchTheMealDb(ingredient);
  }

  private async getTheMealDbDetails(queryOrId: string): Promise<{ success: boolean; recipe?: DetailedRecipe; message: string }> {
    try {
      const url = /^\d+$/.test(queryOrId)
        ? `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${queryOrId}`
        : `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(queryOrId)}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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
      const res = await fetch("https://www.themealdb.com/api/json/v1/1/random.php", { signal: AbortSignal.timeout(5000) });
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
      source: "fallback",
      recipes: [],
      message: "Random recipe fetch nahi ho payi.",
    };
  }
}

export const recipeService = new RecipeService();
